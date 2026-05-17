"use node";

import { randomUUID } from "node:crypto";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { v } from "convex/values";

import type { GenericActionCtx } from "convex/server";
import { action, internalAction } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { DataModel, Id } from "../_generated/dataModel";

type ActionCtx = GenericActionCtx<DataModel>;
import {
  createAnchorClient,
  getAnchorProvider,
  STELLAR_NETWORK_PASSPHRASES,
} from "../../src/lib/anchors/registry";
import { SepApiError, type TransactionStatus } from "../../src/lib/anchors/sep/types";
import {
  AnchorError,
  type TransactionStatus as AnchorTransactionStatus,
} from "../../src/lib/anchors/types";
import { ASSETS } from "../../src/lib/stellar/assets";
import {
  getEtherfuseApiKey,
  getEtherfuseBaseUrl,
  getStellarHorizonUrl,
  getStellarNetwork,
  getTreasurySecret,
} from "../lib/env";
import { decryptSecret, encryptSecret } from "../lib/secrets";
import { getTreasurySigner } from "../lib/stellarSigner";
import { ANCHOR_ONBOARDING_STATUS } from "./accountDomain";
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

/**
 * Convert a BRL-cent amount to the anchor asset's face-value string at
 * the registry's static rate. This is a placeholder — production will
 * replace with a SEP-38 quote so the rate is locked at deposit time and
 * matched by the anchor on settlement. For testanchor + demo flows the
 * frozen rate is sufficient (and avoids putting CoinGecko on the deposit
 * critical path).
 */
function brlCentsToAssetAmount(brlCents: number, assetSymbol: string): string {
  const asset = ASSETS.find((a) => a.symbol === assetSymbol);
  if (!asset) {
    throw new Error(`Unknown asset "${assetSymbol}" — cannot convert BRL amount`);
  }
  const brlFace = brlCents / 100;
  const assetFace = brlFace / asset.brlPerUnit;
  return assetFace.toFixed(asset.displayDecimals);
}

interface TenantPrefill {
  first_name?: string;
  last_name?: string;
  email_address?: string;
  id_number?: string;
}

/**
 * Resolve SEP-9 tenant fields from a payment row's first line item.
 * Anchor hosted forms pre-fill these (and Etherfuse uses them to seed
 * KYC). Returns an empty object when no contract/tenant is reachable —
 * the deposit still works without prefill.
 */
async function resolveTenantPrefill(
  ctx: ActionCtx,
  contractPublicId: string | undefined,
): Promise<TenantPrefill> {
  if (!contractPublicId) return {};
  const contract = await ctx.runQuery(api.contracts.useCases.getByPublicId, {
    publicId: contractPublicId,
  });
  if (!contract) return {};
  const tenant = contract.tenant;
  const fullName = tenant.fullName.trim();
  const [first, ...rest] = fullName.split(/\s+/);
  return {
    first_name: first ?? undefined,
    last_name: rest.length > 0 ? rest.join(" ") : undefined,
    email_address: tenant.email || undefined,
    id_number: tenant.cpf || undefined,
  };
}

function tenantPrefillToFields(p: TenantPrefill): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined && v !== "") out[k] = v;
  }
  return out;
}

const PUBLIC_APP_URL = "https://mutav.app";

// ─── Error handling ──────────────────────────────────────────────────────────

export const ANCHOR_START_ERROR_CODE = {
  PAYMENT_NOT_FOUND: "PAYMENT_NOT_FOUND",
  NOT_CHARGEABLE: "NOT_CHARGEABLE",
  AMOUNT_INVALID: "AMOUNT_INVALID",
  AMOUNT_OUT_OF_RANGE: "AMOUNT_OUT_OF_RANGE",
  ASSET_UNSUPPORTED: "ASSET_UNSUPPORTED",
  ANCHOR_REJECTED: "ANCHOR_REJECTED",
  ANCHOR_RESPONSE_INVALID: "ANCHOR_RESPONSE_INVALID",
  INTERNAL: "INTERNAL",
} as const;

type AnchorStartErrorCode = (typeof ANCHOR_START_ERROR_CODE)[keyof typeof ANCHOR_START_ERROR_CODE];

const anchorStartErrorCodeValidator = v.union(
  v.literal(ANCHOR_START_ERROR_CODE.PAYMENT_NOT_FOUND),
  v.literal(ANCHOR_START_ERROR_CODE.NOT_CHARGEABLE),
  v.literal(ANCHOR_START_ERROR_CODE.AMOUNT_INVALID),
  v.literal(ANCHOR_START_ERROR_CODE.AMOUNT_OUT_OF_RANGE),
  v.literal(ANCHOR_START_ERROR_CODE.ASSET_UNSUPPORTED),
  v.literal(ANCHOR_START_ERROR_CODE.ANCHOR_REJECTED),
  v.literal(ANCHOR_START_ERROR_CODE.ANCHOR_RESPONSE_INVALID),
  v.literal(ANCHOR_START_ERROR_CODE.INTERNAL),
);

interface AnchorStartError {
  code: AnchorStartErrorCode;
  /** Raw anchor message — useful for ops debugging, not for end-user display (UI maps from `code`). */
  detail?: string;
}

/**
 * Map a SepApiError thrown by the anchor library into a stable error code
 * the UI can localize. Anchors don't expose machine codes for amount/asset
 * errors — we string-match the human messages to bucket them.
 */
function classifySepError(err: SepApiError): AnchorStartError {
  const msg = (err.response?.error ?? err.message).toLowerCase();
  if (msg.includes("amount")) {
    if (msg.includes("min") || msg.includes("max") || msg.includes("range")) {
      return { code: ANCHOR_START_ERROR_CODE.AMOUNT_OUT_OF_RANGE, detail: err.message };
    }
    return { code: ANCHOR_START_ERROR_CODE.AMOUNT_INVALID, detail: err.message };
  }
  if (msg.includes("asset")) {
    return { code: ANCHOR_START_ERROR_CODE.ASSET_UNSUPPORTED, detail: err.message };
  }
  return { code: ANCHOR_START_ERROR_CODE.ANCHOR_REJECTED, detail: err.message };
}

type StartPixOnrampResult =
  | { success: true; data: { orderId: Id<"anchorOrders">; anchorTxId: string } }
  | { success: false; error: AnchorStartError };

type StartAnchorTestOnrampResult =
  | {
      success: true;
      data: { orderId: Id<"anchorOrders">; anchorTxId: string; hostedUrl: string };
    }
  | { success: false; error: AnchorStartError };

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
  args: {
    paymentId: v.id("payments"),
    lang: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        orderId: v.id("anchorOrders"),
        anchorTxId: v.string(),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.object({
        code: anchorStartErrorCodeValidator,
        detail: v.optional(v.string()),
      }),
    }),
  ),
  handler: async (ctx, args): Promise<StartPixOnrampResult> => {
    const payment = await ctx.runQuery(api.payments.useCases.getById, {
      paymentId: args.paymentId,
    });
    if (!payment) {
      return { success: false, error: { code: ANCHOR_START_ERROR_CODE.PAYMENT_NOT_FOUND } };
    }
    if (!isChargeable(payment.state)) {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.NOT_CHARGEABLE,
          detail: payment.state.kind,
        },
      };
    }

    const providerName = await ctx.runQuery(internal.anchors.useCases.getProviderForAgency, {
      agencyId: payment.agencyId,
    });

    // Etherfuse uses a non-SEP REST flow. Dispatch before falling through
    // to the SEP-6 path so we never try to instantiate a SEP client for
    // a provider that doesn't speak the protocol.
    if (providerName === "etherfuse") {
      return startEtherfusePixOnramp(ctx, {
        paymentId: payment._id,
        agencyId: payment.agencyId,
        amountBRLCents: payment.totalCents,
      });
    }

    const providerEntry = getAnchorProvider(providerName);

    const client = createAnchorClient(providerName);
    await client.initialize();

    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const amount = brlCentsToAssetAmount(payment.totalCents, "USDC");
    const tenant = await resolveTenantPrefill(ctx, payment.lineItems[0]?.contractPublicId);

    try {
      const response = await client.sep6.deposit({
        asset_code: "USDC",
        account: signer.publicKey,
        amount,
        // Anchor-specific deposit method. Testanchor accepts SEPA/SWIFT (no
        // real Pix simulation); real Brazilian anchors will accept "pix".
        type: providerEntry.sep6DepositType,
        wallet_name: "Mutav",
        wallet_url: PUBLIC_APP_URL,
        lang: args.lang,
        ...tenantPrefillToFields(tenant),
      });

      if (!response.id) {
        return {
          success: false,
          error: { code: ANCHOR_START_ERROR_CODE.ANCHOR_RESPONSE_INVALID },
        };
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

      return { success: true, data: { orderId, anchorTxId: response.id } };
    } catch (err) {
      if (err instanceof SepApiError) {
        return { success: false, error: classifySepError(err) };
      }
      throw err;
    }
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

    // Dispatch on stored provider — orders from PR-4's startEtherfusePixOnramp
    // land in this same poller via the etherfuse branch.
    if (order.provider === "etherfuse") {
      return pollEtherfusePixOnramp(ctx, {
        _id: order._id,
        anchorTxId: order.anchorTxId,
        paymentId: order.paymentId,
      });
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

// ─── AnchorTest (SEP-24 interactive) ─────────────────────────────────────────

/**
 * Initiate a SEP-24 (interactive / hosted-UI) deposit against the agency's
 * configured anchor. Mirrors `startPixOnramp` but returns the anchor's hosted
 * URL instead of in-app Pix instructions — the client iframes / popups it and
 * the operator completes the deposit on the anchor's own form.
 *
 * This is the "AnchorTest" path the picker offers as a parallel option:
 * useful for QA and demonstrating provider parity, but not the user-facing
 * production flow (which prefers SEP-6 + Mutav-owned UI).
 */
export const startAnchorTestOnramp = action({
  args: {
    paymentId: v.id("payments"),
    lang: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        orderId: v.id("anchorOrders"),
        anchorTxId: v.string(),
        hostedUrl: v.string(),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.object({
        code: anchorStartErrorCodeValidator,
        detail: v.optional(v.string()),
      }),
    }),
  ),
  handler: async (ctx, args): Promise<StartAnchorTestOnrampResult> => {
    const payment = await ctx.runQuery(api.payments.useCases.getById, {
      paymentId: args.paymentId,
    });
    if (!payment) {
      return { success: false, error: { code: ANCHOR_START_ERROR_CODE.PAYMENT_NOT_FOUND } };
    }
    if (!isChargeable(payment.state)) {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.NOT_CHARGEABLE,
          detail: payment.state.kind,
        },
      };
    }

    const providerName = await ctx.runQuery(internal.anchors.useCases.getProviderForAgency, {
      agencyId: payment.agencyId,
    });

    const client = createAnchorClient(providerName);
    await client.initialize();

    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const amount = brlCentsToAssetAmount(payment.totalCents, "USDC");
    const tenant = await resolveTenantPrefill(ctx, payment.lineItems[0]?.contractPublicId);

    try {
      const response = await client.sep24.deposit({
        asset_code: "USDC",
        account: signer.publicKey,
        amount,
        wallet_name: "Mutav",
        wallet_url: PUBLIC_APP_URL,
        lang: args.lang,
        ...tenantPrefillToFields(tenant),
      });

      if (!response.id || !response.url) {
        return {
          success: false,
          error: { code: ANCHOR_START_ERROR_CODE.ANCHOR_RESPONSE_INVALID },
        };
      }

      const orderId = await ctx.runMutation(internal.anchors.orderUseCases.insertOrder, {
        agencyId: payment.agencyId,
        paymentId: payment._id,
        provider: providerName,
        anchorTxId: response.id,
        hostedUrl: response.url,
        status: ANCHOR_ORDER_STATUS.INCOMPLETE,
      });

      return {
        success: true,
        data: { orderId, anchorTxId: response.id, hostedUrl: response.url },
      };
    } catch (err) {
      if (err instanceof SepApiError) {
        return { success: false, error: classifySepError(err) };
      }
      throw err;
    }
  },
});

/**
 * Poll the SEP-24 transaction for an anchor-test order. Shares the
 * normalization + completion handling with `pollPixOnramp`; the only
 * difference is the SEP-24 transfer endpoint vs SEP-6.
 */
export const pollAnchorTestOnramp = action({
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

    // PR-4 will dispatch on order.provider here. SEP-24 is testanchor-only;
    // etherfuse uses a REST flow that doesn't pass through this action.
    if (order.provider !== "testanchor") {
      throw new Error(`pollAnchorTestOnramp not yet implemented for provider ${order.provider}`);
    }
    const client = createAnchorClient(order.provider);
    await client.initialize();
    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const tx = await client.sep24.getTransaction(order.anchorTxId);
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

// ─── Etherfuse proxy account provisioning ─────────────────────────────────────

// TESOURO is a Brazilian Treasury-tokenized asset issued by Etherfuse.
// 7-char code → credit_alphanum12 trustline. Hardcoded here because PR-2
// only needs to open the trustline; PR-4 (checkout wiring) is the right
// place to promote into src/lib/stellar/assets.ts.
const TESOURO_ASSET_CODE = "TESOURO";
const TESOURO_ISSUER = "GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";

const PROXY_STARTING_BALANCE_XLM = "0";
const PROVISIONING_OP_COUNT = 4;
const TX_TIMEOUT_SECONDS = 180;

function getStellarNetworkPassphrase(): string {
  return STELLAR_NETWORK_PASSPHRASES[getStellarNetwork() === "public" ? "pubnet" : "testnet"];
}

type ProvisionAgencyEtherfuseAccountResult = {
  accountId: Id<"anchorAccounts">;
  publicKey: string;
  transactionHash: string;
  alreadyProvisioned: boolean;
};

/**
 * Create the per-agency Stellar proxy account that Etherfuse delivers
 * TESOURO into. Idempotent — if an `anchorAccounts` row already exists
 * for (agency, etherfuse), returns its publicKey without doing anything
 * on-chain.
 *
 * The provisioning tx follows the Zero-Friction pattern from
 * labs/masterclass/01-sdk-advanced/04-zero-friction-onboarding.ts:
 *
 *   BeginSponsoringFutureReserves(sponsoredId=proxy)   source: treasury
 *   CreateAccount(destination=proxy, startingBalance=0) source: treasury
 *   ChangeTrust(source=proxy, asset=TESOURO)
 *   EndSponsoringFutureReserves(source=proxy)
 *
 * Treasury holds the reserves so the proxy lands at 0 XLM with a TESOURO
 * trustline open. The proxy's secret is encrypted under the project key
 * before persisting; we never store raw seeds in the database.
 *
 * PR-3 picks up customerId/bankAccountId from the inserted row and
 * registers them with Etherfuse via POST /ramp/onboarding-url.
 */
export const provisionAgencyEtherfuseAccount = internalAction({
  args: { agencyId: v.id("agencies") },
  returns: v.object({
    accountId: v.id("anchorAccounts"),
    publicKey: v.string(),
    transactionHash: v.string(),
    alreadyProvisioned: v.boolean(),
  }),
  handler: async (ctx, args): Promise<ProvisionAgencyEtherfuseAccountResult> => {
    const existing = await ctx.runQuery(internal.anchors.accountUseCases.getByAgencyAndProvider, {
      agencyId: args.agencyId,
      provider: "etherfuse",
    });
    if (existing && existing.data.provider !== "etherfuse") {
      throw new Error(
        `anchorAccounts ${existing._id} has provider=etherfuse but data.provider=${existing.data.provider}`,
      );
    }
    if (existing?.data.provider === "etherfuse" && existing.data.provisioningTxHash) {
      return {
        accountId: existing._id,
        publicKey: existing.data.publicKey,
        transactionHash: existing.data.provisioningTxHash,
        alreadyProvisioned: true,
      };
    }

    // Existing row without a tx hash means a previous attempt persisted
    // the encrypted secret but failed before the on-chain submit
    // confirmed. Reuse the same keypair so the on-chain account (if it
    // did make it on-chain in a prior failed run) lines up, otherwise
    // mint a new one.
    let proxyKeypair: Keypair;
    let accountId: Id<"anchorAccounts">;
    let publicKey: string;
    if (existing?.data.provider === "etherfuse") {
      proxyKeypair = Keypair.fromSecret(decryptSecret(existing.data.encryptedSecret));
      accountId = existing._id;
      publicKey = existing.data.publicKey;
    } else {
      proxyKeypair = Keypair.random();
      publicKey = proxyKeypair.publicKey();
      const encryptedSecret = encryptSecret(proxyKeypair.secret());
      // Persist first — if the Stellar submit below throws after the
      // account is created on-chain, we still hold the secret and can
      // recover by re-running this action (the retry branch above).
      accountId = await ctx.runMutation(internal.anchors.accountUseCases.insertEtherfuseAccount, {
        agencyId: args.agencyId,
        customerId: randomUUID(),
        bankAccountId: randomUUID(),
        publicKey,
        encryptedSecret,
      });
    }

    const treasury = Keypair.fromSecret(getTreasurySecret());
    const horizon = new Horizon.Server(getStellarHorizonUrl());
    const treasuryAccount = await horizon.loadAccount(treasury.publicKey());

    const tx = new TransactionBuilder(treasuryAccount, {
      fee: String(Number(BASE_FEE) * PROVISIONING_OP_COUNT),
      networkPassphrase: getStellarNetworkPassphrase(),
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({ sponsoredId: proxyKeypair.publicKey() }),
      )
      .addOperation(
        Operation.createAccount({
          destination: proxyKeypair.publicKey(),
          // 0 XLM is only legal because the base reserve is sponsored.
          startingBalance: PROXY_STARTING_BALANCE_XLM,
        }),
      )
      .addOperation(
        Operation.changeTrust({
          source: proxyKeypair.publicKey(),
          asset: new Asset(TESOURO_ASSET_CODE, TESOURO_ISSUER),
        }),
      )
      .addOperation(Operation.endSponsoringFutureReserves({ source: proxyKeypair.publicKey() }))
      .setTimeout(TX_TIMEOUT_SECONDS)
      .build();

    tx.sign(treasury, proxyKeypair);

    let transactionHash: string;
    try {
      const submitResult = await horizon.submitTransaction(tx);
      transactionHash = submitResult.hash;
    } catch (err) {
      // Retry path: a prior attempt's submit may have actually landed
      // on-chain. Horizon reports this as op_already_exists on
      // createAccount. Confirm by loading the account; if it's there,
      // the on-chain reality matches what we want and we can mark the
      // row provisioned without a real hash.
      if (existing && isOpAlreadyExistsError(err)) {
        await horizon.loadAccount(publicKey);
        transactionHash = "(recovered: account already on-chain)";
      } else {
        throw err;
      }
    }

    await ctx.runMutation(internal.anchors.accountUseCases.markEtherfuseProvisioningHash, {
      accountId,
      provisioningTxHash: transactionHash,
    });

    return {
      accountId,
      publicKey,
      transactionHash,
      alreadyProvisioned: false,
    };
  },
});

/**
 * True if a Horizon submit error reports `op_already_exists` on any
 * operation — the marker that a prior provisioning tx actually landed
 * on-chain even though our flow believes it failed.
 */
function isOpAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("response" in err)) return false;
  const response = err.response;
  if (typeof response !== "object" || response === null || !("data" in response)) return false;
  const data = response.data;
  if (typeof data !== "object" || data === null || !("extras" in data)) return false;
  const extras = data.extras;
  if (typeof extras !== "object" || extras === null || !("result_codes" in extras)) return false;
  const resultCodes = extras.result_codes;
  if (typeof resultCodes !== "object" || resultCodes === null || !("operations" in resultCodes))
    return false;
  const operations = resultCodes.operations;
  return Array.isArray(operations) && operations.includes("op_already_exists");
}

// ─── Etherfuse agency onboarding (provision + KYC + terms) ────────────────────

type OnboardAgencyEtherfuseArgs = {
  agencyId: Id<"agencies">;
  contactPerson: {
    givenName: string;
    familyName: string;
    dateOfBirth: string;
  };
  address: {
    street: string;
    city: string;
    region: string;
    postalCode: string;
  };
};

type OnboardAgencyEtherfuseResult = {
  accountId: Id<"anchorAccounts">;
  publicKey: string;
  customerId: string;
  kycStatus: string;
};

/**
 * Full agency onboarding: provision Stellar proxy account (PR-2) → register
 * with Etherfuse → submit KYC → accept terms. Idempotent; safe to re-run.
 *
 * For BR, the masterclass + labs confirmed the personal-flow path works in
 * sandbox even for businesses. Full business-KYB (`POST /ramp/organization`,
 * `accountType: business`) is a follow-up — see the vendored client's
 * `createBusinessCustomer` for that path.
 *
 * Sandbox auto-approves KYC when the payload includes nested `id` fields
 * (see MUTAV LOCAL PATCH comments in
 * `src/lib/anchors/etherfuse/types.ts → EtherfuseKycIdentityRequest`).
 * Production gates KYC on real-document review.
 */
export const onboardAgencyEtherfuse = internalAction({
  args: {
    agencyId: v.id("agencies"),
    contactPerson: v.object({
      givenName: v.string(),
      familyName: v.string(),
      dateOfBirth: v.string(),
    }),
    address: v.object({
      street: v.string(),
      city: v.string(),
      region: v.string(),
      postalCode: v.string(),
    }),
  },
  returns: v.object({
    accountId: v.id("anchorAccounts"),
    publicKey: v.string(),
    customerId: v.string(),
    kycStatus: v.string(),
  }),
  handler: async (ctx, args: OnboardAgencyEtherfuseArgs): Promise<OnboardAgencyEtherfuseResult> => {
    // Step 1: provision Stellar proxy account (idempotent). Discard the
    // return value — we re-read the row in Step 2 to also handle the
    // already-provisioned case uniformly.
    await ctx.runAction(internal.anchors.actions.provisionAgencyEtherfuseAccount, {
      agencyId: args.agencyId,
    });

    // Step 2: load the row we just wrote (or already had) for UUIDs.
    const account = await ctx.runQuery(internal.anchors.accountUseCases.getByAgencyAndProvider, {
      agencyId: args.agencyId,
      provider: "etherfuse",
    });
    if (!account || account.data.provider !== "etherfuse") {
      throw new Error(`Failed to load anchorAccounts row for agency ${args.agencyId}`);
    }
    if (account.status === ANCHOR_ONBOARDING_STATUS.APPROVED) {
      return {
        accountId: account._id,
        publicKey: account.data.publicKey,
        customerId: account.externalId ?? "",
        kycStatus: account.data.kycStatus,
      };
    }

    // Step 3: read agency CNPJ for the KYC payload.
    const agency = await ctx.runQuery(api.agencies.useCases.getById, {
      agencyId: args.agencyId,
    });
    if (!agency) throw new Error(`Agency ${args.agencyId} not found`);

    const customerId = account.externalId;
    if (!customerId) {
      throw new Error(`anchorAccounts ${account._id} has null externalId`);
    }
    const { bankAccountId, publicKey } = account.data;

    // Step 4: instantiate client + register the trio with Etherfuse.
    // EtherfuseClient is imported lazily to keep startup-cost out of the
    // hot path for actions that don't touch Etherfuse.
    const { EtherfuseClient } = await import("../../src/lib/anchors/etherfuse/index");
    const client = new EtherfuseClient({
      apiKey: getEtherfuseApiKey(),
      baseUrl: getEtherfuseBaseUrl(),
      defaultBlockchain: "stellar",
    });
    const presignedUrl = await client.getKycUrl(customerId, publicKey, bankAccountId);

    // Step 5: programmatic KYC submission. Sandbox auto-approves with the
    // nested-id payload below; production gates on document review.
    await client.submitKycIdentity(customerId, {
      id: randomUUID(),
      pubkey: publicKey,
      identity: {
        id: randomUUID(),
        name: {
          givenName: args.contactPerson.givenName,
          familyName: args.contactPerson.familyName,
        },
        dateOfBirth: args.contactPerson.dateOfBirth,
        address: {
          id: randomUUID(),
          street: args.address.street,
          city: args.address.city,
          region: args.address.region,
          postalCode: args.address.postalCode,
          // Mutav is BR-only by design.
          country: "BR",
        },
        idNumbers: [
          {
            id: randomUUID(),
            value: agency.cnpj,
            type: "CNPJ",
          },
        ],
      },
    });

    // Step 6: terms acceptance. Single endpoint suffices for sandbox; full
    // 3-agreement flow (acceptAgreements) is gated by phone-number collection
    // which is a production-only concern.
    await client.acceptTermsAndConditions(presignedUrl);

    // Step 7: flip the row's status to approved.
    await ctx.runMutation(internal.anchors.accountUseCases.updateStatus, {
      accountId: account._id,
      status: ANCHOR_ONBOARDING_STATUS.APPROVED,
    });
    await ctx.runMutation(internal.anchors.accountUseCases.updateEtherfuseKycStatus, {
      accountId: account._id,
      kycStatus: "approved",
    });

    return {
      accountId: account._id,
      publicKey,
      customerId,
      kycStatus: "approved",
    };
  },
});

// ─── Etherfuse Pix on-ramp (REST flow, called from startPixOnramp dispatch) ──

/**
 * Map the vendored Anchor-interface TransactionStatus to Mutav's normalized
 * anchorOrderStatus. The vendored EtherfuseClient collapses Etherfuse's
 * granular states (`created | funded | completed | finalized | failed |
 * refunded | canceled`) into this smaller set before returning, so this
 * mapping only needs to handle the 7-value abstraction.
 */
function normalizeEtherfuseStatus(status: AnchorTransactionStatus): AnchorOrderStatus {
  switch (status) {
    case "pending":
      return ANCHOR_ORDER_STATUS.PENDING_USER_TRANSFER_START;
    case "processing":
      return ANCHOR_ORDER_STATUS.PENDING_ANCHOR;
    case "completed":
      return ANCHOR_ORDER_STATUS.COMPLETED;
    case "failed":
    case "cancelled":
      return ANCHOR_ORDER_STATUS.ERROR;
    case "expired":
      return ANCHOR_ORDER_STATUS.EXPIRED;
    case "refunded":
      return ANCHOR_ORDER_STATUS.REFUNDED;
  }
}

function brlCentsToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Build the `instructions` payload that `checkout-pix-view.tsx` consumes.
 * The view looks for snake_case keys (`pix_qr_code`/`pix_br_code` for the
 * QR, `pix_copia_cola`/`pix_copy_paste` for the copy-paste string). The
 * Etherfuse client returns a typed object with camelCase fields; flatten
 * here so the view doesn't need a per-provider branch.
 */
function etherfusePixInstructions(pixData: {
  pixCode: string;
  pixKey?: string;
  pixKeyType?: string;
  beneficiary?: string;
  amount: string;
  currency: string;
}): Record<string, string> {
  const out: Record<string, string> = {
    pix_br_code: pixData.pixCode,
    pix_copia_cola: pixData.pixCode,
    amount: pixData.amount,
    currency: pixData.currency,
  };
  if (pixData.pixKey) out.pix_chave = pixData.pixKey;
  if (pixData.pixKeyType) out.pix_chave_type = pixData.pixKeyType;
  if (pixData.beneficiary) out.beneficiary = pixData.beneficiary;
  return out;
}

type EtherfuseStartContext = {
  paymentId: Id<"payments">;
  agencyId: Id<"agencies">;
  amountBRLCents: number;
};

async function startEtherfusePixOnramp(
  ctx: ActionCtx,
  context: EtherfuseStartContext,
): Promise<StartPixOnrampResult> {
  const account = await ctx.runQuery(internal.anchors.accountUseCases.getByAgencyAndProvider, {
    agencyId: context.agencyId,
    provider: "etherfuse",
  });
  if (!account || account.data.provider !== "etherfuse") {
    return {
      success: false,
      error: {
        code: ANCHOR_START_ERROR_CODE.ANCHOR_REJECTED,
        detail: "Etherfuse account not provisioned for this agency",
      },
    };
  }
  if (account.data.kycStatus !== "approved") {
    return {
      success: false,
      error: {
        code: ANCHOR_START_ERROR_CODE.ANCHOR_REJECTED,
        detail: `KYC status ${account.data.kycStatus} (must be approved before orders)`,
      },
    };
  }
  if (!account.externalId) {
    return {
      success: false,
      error: { code: ANCHOR_START_ERROR_CODE.INTERNAL, detail: "missing customerId" },
    };
  }

  const { EtherfuseClient } = await import("../../src/lib/anchors/etherfuse/index");
  const client = new EtherfuseClient({
    apiKey: getEtherfuseApiKey(),
    baseUrl: getEtherfuseBaseUrl(),
    defaultBlockchain: "stellar",
  });

  const amountBRL = brlCentsToString(context.amountBRLCents);

  try {
    // 1. Get a fresh quote (quotes expire in ~15 min; re-fetching on every
    //    page load is cheap and avoids stale-quote 400s).
    const quote = await client.getQuote({
      customerId: account.externalId,
      fromCurrency: "BRL",
      toCurrency: "TESOURO",
      fromAmount: amountBRL,
      stellarAddress: account.data.publicKey,
    });

    // 2. Create the order. Etherfuse returns Pix payment instructions.
    const onramp = await client.createOnRamp({
      customerId: account.externalId,
      quoteId: quote.id,
      bankAccountId: account.data.bankAccountId,
      stellarAddress: account.data.publicKey,
      amount: amountBRL,
      fromCurrency: "BRL",
      toCurrency: "TESOURO",
    });

    if (!onramp.paymentInstructions || onramp.paymentInstructions.type !== "pix") {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.ANCHOR_RESPONSE_INVALID,
          detail: `expected pix instructions, got ${onramp.paymentInstructions?.type ?? "none"}`,
        },
      };
    }

    const orderId = await ctx.runMutation(internal.anchors.orderUseCases.insertOrder, {
      agencyId: context.agencyId,
      paymentId: context.paymentId,
      provider: "etherfuse",
      anchorTxId: onramp.id,
      instructions: etherfusePixInstructions(onramp.paymentInstructions),
      status: ANCHOR_ORDER_STATUS.PENDING_USER_TRANSFER_START,
    });

    return { success: true, data: { orderId, anchorTxId: onramp.id } };
  } catch (err: unknown) {
    // AnchorError = anchor really returned a 4xx/5xx (quote expired, KYC
    // issue, validation, etc.) → surface as anchor-side rejection so the
    // UI tells the user the anchor declined. Anything else (TypeError,
    // network failure, our own bug) → INTERNAL so we don't blame the
    // anchor for our problems. Non-Error throws bubble up untouched.
    if (err instanceof AnchorError) {
      return {
        success: false,
        error: { code: ANCHOR_START_ERROR_CODE.ANCHOR_REJECTED, detail: err.message },
      };
    }
    if (err instanceof Error) {
      return {
        success: false,
        error: { code: ANCHOR_START_ERROR_CODE.INTERNAL, detail: err.message },
      };
    }
    throw err;
  }
}

async function pollEtherfusePixOnramp(
  ctx: ActionCtx,
  order: { _id: Id<"anchorOrders">; anchorTxId: string; paymentId: Id<"payments"> },
): Promise<PollPixOnrampResult> {
  const { EtherfuseClient } = await import("../../src/lib/anchors/etherfuse/index");
  const client = new EtherfuseClient({
    apiKey: getEtherfuseApiKey(),
    baseUrl: getEtherfuseBaseUrl(),
    defaultBlockchain: "stellar",
  });

  const tx = await client.getOnRampTransaction(order.anchorTxId);
  if (!tx) {
    // Etherfuse 404 — the order doesn't exist on their side anymore.
    // Persist as terminal ERROR so the poller stops retrying instead
    // of throwing forever and pinning the row in a pending state.
    await ctx.runMutation(internal.anchors.orderUseCases.updateOrderStatus, {
      orderId: order._id,
      status: ANCHOR_ORDER_STATUS.ERROR,
    });
    return { orderId: order._id, status: ANCHOR_ORDER_STATUS.ERROR, terminal: true };
  }

  const status = normalizeEtherfuseStatus(tx.status);
  const terminal = isTerminal(status);

  await ctx.runMutation(internal.anchors.orderUseCases.updateOrderStatus, {
    orderId: order._id,
    status,
    // completedAt is the timestamp of terminal resolution, not the last
    // update — only write it when the order has actually settled.
    completedAt: terminal ? tx.updatedAt : undefined,
    rawPayload: tx,
  });

  if (status === ANCHOR_ORDER_STATUS.COMPLETED) {
    const pixKey =
      tx.paymentInstructions?.type === "pix" && tx.paymentInstructions.pixKey
        ? tx.paymentInstructions.pixKey
        : `etherfuse:${order.anchorTxId}`;
    const paidAt = tx.updatedAt ?? new Date().toISOString();
    await ctx.runMutation(internal.payments.mutations.markPaidByAnchor, {
      paymentId: order.paymentId,
      anchorTxId: order.anchorTxId,
      pixKey,
      paidAt,
    });
  }

  return { orderId: order._id, status, terminal };
}
