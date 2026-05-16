"use node";

import { v } from "convex/values";

import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  createAnchorClient,
  getAnchorProvider,
  STELLAR_NETWORK_PASSPHRASES,
} from "../../src/lib/anchors/registry";
import type { TransactionStatus } from "../../src/lib/anchors/sep/types";
import { getTreasurySigner } from "../lib/stellarSigner";
import { anchorProviderValidator, type AnchorProvider } from "./domain";
import {
  ANCHOR_ORDER_STATUS,
  anchorOrderStatusValidator,
  isTerminal,
  type AnchorOrderStatus,
} from "./orderDomain";
import { isChargeable } from "../payments/domain";

type CurrencyStatus = "live" | "dead" | "test" | "private";

interface AnchorCurrencyOut {
  code: string;
  issuer?: string;
  sep38Id: string;
  status: CurrencyStatus;
}

interface AnchorCapabilities {
  provider: AnchorProvider;
  network: "testnet" | "pubnet";
  networkPassphrase: string;
  signingKey: string | null;
  currencies: Array<{
    code: string;
    issuer?: string;
    sep38Id: string;
    status: "live" | "dead" | "test" | "private";
  }>;
  supports: {
    sep6: boolean;
    sep10: boolean;
    sep12: boolean;
    sep24: boolean;
    sep31: boolean;
    sep38: boolean;
  };
}

/**
 * Discover what the anchor configured for this agency supports.
 *
 * Runs the registry → client → SEP-1 path end-to-end against a real
 * anchor. No auth, no deposit — proves the wiring works and surfaces
 * the capability matrix the UI uses when offering payment methods.
 */
export const discoverCapabilities = internalAction({
  args: { agencyId: v.id("agencies") },
  returns: v.object({
    provider: anchorProviderValidator,
    network: v.union(v.literal("testnet"), v.literal("pubnet")),
    networkPassphrase: v.string(),
    signingKey: v.union(v.string(), v.null()),
    currencies: v.array(
      v.object({
        code: v.string(),
        issuer: v.optional(v.string()),
        sep38Id: v.string(),
        status: v.union(
          v.literal("live"),
          v.literal("dead"),
          v.literal("test"),
          v.literal("private"),
        ),
      }),
    ),
    supports: v.object({
      sep6: v.boolean(),
      sep10: v.boolean(),
      sep12: v.boolean(),
      sep24: v.boolean(),
      sep31: v.boolean(),
      sep38: v.boolean(),
    }),
  }),
  handler: async (ctx, args): Promise<AnchorCapabilities> => {
    const providerName = await ctx.runQuery(internal.anchors.useCases.getProviderForAgency, {
      agencyId: args.agencyId,
    });
    const provider = getAnchorProvider(providerName);
    const expectedPassphrase = STELLAR_NETWORK_PASSPHRASES[provider.network];

    const client = createAnchorClient(providerName);
    const toml = await client.initialize();

    if (toml.NETWORK_PASSPHRASE !== expectedPassphrase) {
      throw new Error(
        `Anchor "${providerName}" returned NETWORK_PASSPHRASE "${toml.NETWORK_PASSPHRASE ?? "(none)"}", ` +
          `expected "${expectedPassphrase}" for ${provider.network}. Refusing to proceed — ` +
          `this would cause signed transactions to be rejected on submission.`,
      );
    }

    const [sep6, sep10, sep12, sep24, sep31, sep38] = await Promise.all([
      client.supportsSep(6),
      client.supportsSep(10),
      client.supportsSep(12),
      client.supportsSep(24),
      client.supportsSep(31),
      client.supportsSep(38),
    ]);

    const allowed: ReadonlyArray<CurrencyStatus | undefined> = provider.sandbox
      ? ["live", "test", undefined]
      : ["live", undefined];
    const currencies: AnchorCurrencyOut[] = (toml.CURRENCIES ?? [])
      .filter((c) => allowed.includes(c.status as CurrencyStatus | undefined))
      .map<AnchorCurrencyOut>((c) => {
        const isNative = c.code === "native" || (c.code === "XLM" && !c.issuer);
        const code = isNative ? "XLM" : (c.code ?? "");
        const issuer = isNative ? undefined : c.issuer;
        return {
          code,
          issuer,
          sep38Id: isNative ? "stellar:native" : `stellar:${code}:${issuer}`,
          status: ((c.status as CurrencyStatus | undefined) ?? "live") satisfies CurrencyStatus,
        };
      });

    return {
      provider: providerName,
      network: provider.network,
      networkPassphrase: expectedPassphrase,
      signingKey: toml.SIGNING_KEY ?? null,
      currencies,
      supports: { sep6, sep10, sep12, sep24, sep31, sep38 },
    };
  },
});

// ─── Pix on-ramp (SEP-24 deposit) ─────────────────────────────────────────────

/**
 * Normalize the SEP-24 transaction status enum to Mutav's `anchorOrderStatus`.
 * SEP-24 has many fine-grained "pending_*" variants that don't matter to our
 * UI; we collapse them onto the smaller normalized set so the dialog has
 * predictable transitions and future non-SEP providers (Etherfuse) can map
 * onto the same shape.
 */
function normalizeSep24Status(sepStatus: TransactionStatus): AnchorOrderStatus {
  switch (sepStatus) {
    case "incomplete":
      return ANCHOR_ORDER_STATUS.INCOMPLETE;
    case "pending_user_transfer_start":
    case "pending_user":
      return ANCHOR_ORDER_STATUS.PENDING_USER_TRANSFER_START;
    case "pending_user_transfer_complete":
      return ANCHOR_ORDER_STATUS.PENDING_USER_TRANSFER_COMPLETE;
    case "pending_stellar":
    case "pending_trust":
      return ANCHOR_ORDER_STATUS.PENDING_STELLAR;
    case "pending_anchor":
    case "pending_external":
    case "pending_customer_info_update":
    case "pending_transaction_info_update":
    case "pending_sender":
    case "pending_receiver":
      return ANCHOR_ORDER_STATUS.PENDING_ANCHOR;
    case "completed":
      return ANCHOR_ORDER_STATUS.COMPLETED;
    case "refunded":
      return ANCHOR_ORDER_STATUS.REFUNDED;
    case "expired":
      return ANCHOR_ORDER_STATUS.EXPIRED;
    case "error":
    case "no_market":
      return ANCHOR_ORDER_STATUS.ERROR;
  }
}

function brlToCents(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return undefined;
  return Math.round(num * 100);
}

interface StartPixOnrampResult {
  orderId: Id<"anchorOrders">;
  anchorTxId: string;
}

interface PollPixOnrampResult {
  orderId: Id<"anchorOrders">;
  status: AnchorOrderStatus;
  terminal: boolean;
}

/**
 * Initiate a SEP-6 (programmatic) deposit against the agency's configured
 * anchor for the given chargeable payment. Returns the persisted order;
 * the UI subscribes to it reactively and renders the deposit instructions
 * (Pix QR + key/copy fields) in-app rather than handing off to the
 * anchor's hosted page.
 *
 * Why SEP-6 over SEP-24: testanchor's hosted form (and any anchor's
 * hosted UI) is generic and not Pix-shaped. SEP-6 returns the raw
 * instructions and lets Mutav own the UX. The same UI consumes Etherfuse
 * instructions when that provider lands — registry pattern preserved.
 */
export const startPixOnramp = action({
  args: { paymentId: v.id("payments") },
  returns: v.object({
    orderId: v.id("anchorOrders"),
    anchorTxId: v.string(),
  }),
  handler: async (ctx, args): Promise<StartPixOnrampResult> => {
    const payment = await ctx.runQuery(api.payments.useCases.getById, {
      paymentId: args.paymentId,
    });
    if (!payment) throw new Error(`Payment ${args.paymentId} not found`);
    if (!isChargeable(payment.state)) {
      throw new Error(
        `Payment ${args.paymentId} is in state "${payment.state.kind}" — cannot initiate on-ramp`,
      );
    }

    const providerName = await ctx.runQuery(internal.anchors.useCases.getProviderForAgency, {
      agencyId: payment.agencyId,
    });
    const providerEntry = getAnchorProvider(providerName);

    const client = createAnchorClient(providerName);
    await client.initialize();

    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const amount = (payment.totalCents / 100).toFixed(2);
    const response = await client.sep6.deposit({
      asset_code: "USDC",
      account: signer.publicKey,
      amount,
      // Anchor-specific deposit method. Testanchor accepts SEPA/SWIFT (no
      // real Pix simulation); real Brazilian anchors will accept "pix".
      type: providerEntry.sep6DepositType,
      wallet_name: "Mutav",
    });

    if (!response.id) {
      throw new Error(
        `Anchor "${providerName}" SEP-6 deposit response did not include a transaction id; cannot persist order.`,
      );
    }

    const orderId = await ctx.runMutation(internal.anchors.orderUseCases.insertOrder, {
      agencyId: payment.agencyId,
      paymentId: payment._id,
      provider: providerName,
      anchorTxId: response.id,
      instructions: response.instructions,
      how: response.how,
      status: ANCHOR_ORDER_STATUS.INCOMPLETE,
    });

    return { orderId, anchorTxId: response.id };
  },
});

/**
 * Poll the anchor for the current state of an in-flight on-ramp order.
 *
 * The client UI calls this on an interval while a deposit is open. Updates
 * the `anchorOrders` row with the latest SEP-24 transaction snapshot and,
 * on terminal `completed`, marks the parent payment paid via
 * `markPaidByAnchor` (idempotent). Once the order is terminal, subsequent
 * polls short-circuit and return the order unchanged.
 */
export const pollPixOnramp = action({
  args: { orderId: v.id("anchorOrders") },
  returns: v.object({
    orderId: v.id("anchorOrders"),
    status: anchorOrderStatusValidator,
    terminal: v.boolean(),
  }),
  handler: async (ctx, args): Promise<PollPixOnrampResult> => {
    const order = await ctx.runQuery(api.anchors.orderUseCases.getOrderById, {
      orderId: args.orderId,
    });
    if (!order) throw new Error(`Anchor order ${args.orderId} not found`);

    if (isTerminal(order.status)) {
      return { orderId: order._id, status: order.status, terminal: true };
    }

    const client = createAnchorClient(order.provider);
    await client.initialize();
    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const tx = await client.sep6.getTransaction(order.anchorTxId);
    const status = normalizeSep24Status(tx.status);

    await ctx.runMutation(internal.anchors.orderUseCases.updateOrderStatus, {
      orderId: order._id,
      status,
      amountInCents: brlToCents(tx.amount_in),
      amountOutCents: brlToCents(tx.amount_out),
      feeCents: brlToCents(tx.amount_fee),
      completedAt: tx.completed_at,
      rawPayload: tx,
    });

    if (status === ANCHOR_ORDER_STATUS.COMPLETED) {
      const pixKey = tx.from ?? `anchor:${order.anchorTxId}`;
      const paidAt = tx.completed_at ?? new Date().toISOString();
      await ctx.runMutation(internal.payments.mutations.markPaidByAnchor, {
        paymentId: order.paymentId,
        anchorTxId: order.anchorTxId,
        pixKey,
        paidAt,
      });
    }

    return { orderId: order._id, status, terminal: isTerminal(status) };
  },
});
