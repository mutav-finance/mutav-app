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
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { DataModel } from "../../_generated/dataModel";

type ActionCtx = GenericActionCtx<DataModel>;
import {
  createAnchorClient,
  getAnchorProvider,
  STELLAR_NETWORK_PASSPHRASES,
} from "../../../apps/agency/src/lib/anchors/registry";
import {
  SepApiError,
  type TransactionStatus,
} from "../../../apps/agency/src/lib/anchors/sep/types";
import {
  AnchorError,
  type TransactionStatus as AnchorTransactionStatus,
} from "../../../apps/agency/src/lib/anchors/types";
import { ASSETS } from "../../../apps/agency/src/lib/stellar/assets";
import type { AgencyId } from "../../agencies/domain";
import type { InvoiceId } from "../../invoices/domain";
import {
  getEtherfuseApiKey,
  getEtherfuseBaseUrl,
  getStellarHorizonUrl,
  getStellarNetwork,
  getTreasurySecret,
} from "../../lib/env";
import { logWarn } from "../../lib/logger";
import { decryptSecret, encryptSecret } from "../../lib/secrets";
import { getTreasurySigner } from "../../lib/stellarSigner";
import { tenantToSep9Prefill, type TenantPrefill } from "./tenantPrefill";
import { ANCHOR_ONBOARDING_STATUS, type AnchorAccountId } from "./accountDomain";
import { anchorProviderValidator, type AnchorProvider } from "./domain";
import {
  PROVIDER_ORDER_STATUS,
  providerOrderStatusValidator,
  isTerminal,
  type ProviderOrderStatus,
  type ProviderOrderId,
} from "./orderDomain";
import type { AgencyBankAccountId } from "./bankAccountDomain";
import { isChargeable, type BearerDenialReason } from "../../invoices/domain";

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
    const providerName = await ctx.runQuery(
      internal.payments.providers.useCases.getProviderForAgency,
      {
        agencyId: args.agencyId,
      },
    );
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
function normalizeSep24Status(sepStatus: TransactionStatus): ProviderOrderStatus {
  switch (sepStatus) {
    case "incomplete":
      return PROVIDER_ORDER_STATUS.INCOMPLETE;
    case "pending_user_transfer_start":
    case "pending_user":
      return PROVIDER_ORDER_STATUS.PENDING_USER_TRANSFER_START;
    case "pending_user_transfer_complete":
      return PROVIDER_ORDER_STATUS.PENDING_USER_TRANSFER_COMPLETE;
    case "pending_stellar":
    case "pending_trust":
      return PROVIDER_ORDER_STATUS.PENDING_STELLAR;
    case "pending_anchor":
    case "pending_external":
    case "pending_customer_info_update":
    case "pending_transaction_info_update":
    case "pending_sender":
    case "pending_receiver":
      return PROVIDER_ORDER_STATUS.PENDING_ANCHOR;
    case "completed":
      return PROVIDER_ORDER_STATUS.COMPLETED;
    case "refunded":
      return PROVIDER_ORDER_STATUS.REFUNDED;
    case "expired":
      return PROVIDER_ORDER_STATUS.EXPIRED;
    case "error":
    case "no_market":
      return PROVIDER_ORDER_STATUS.ERROR;
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

/**
 * Resolve SEP-9 tenant fields from a payment row's first line item. The
 * identity is the owning agency's own submission, NOT the shared registry row
 * — that row keeps its first writer's values and is never patched, so reading
 * it here would ship another agency's contact data to a third-party anchor and
 * pin it there permanently (LGPD-26). Returns an empty object when no
 * contract/tenant is reachable — the deposit still works without prefill.
 *
 * `agencyId` comes from the invoice being paid, so a `contractPublicId` that
 * also exists under another agency cannot pull that agency's tenant in.
 */
async function resolveTenantPrefill(
  ctx: ActionCtx,
  args: { agencyId: AgencyId; contractPublicId: string | undefined },
): Promise<TenantPrefill> {
  if (!args.contractPublicId) return {};
  const identity = await ctx.runQuery(internal.contracts.useCases.getTenantIdentityInternal, {
    agencyId: args.agencyId,
    publicId: args.contractPublicId,
  });
  if (!identity) return {};
  return tenantToSep9Prefill(identity);
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
  NO_BANK_ACCOUNT: "NO_BANK_ACCOUNT",
  RATE_LIMITED: "RATE_LIMITED",
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
  v.literal(ANCHOR_START_ERROR_CODE.NO_BANK_ACCOUNT),
  v.literal(ANCHOR_START_ERROR_CODE.RATE_LIMITED),
  v.literal(ANCHOR_START_ERROR_CODE.INTERNAL),
);

/**
 * Collapse every bearer denial except the rate limit into `PAYMENT_NOT_FOUND`.
 * An unauthenticated caller learns only that the link no longer works, never
 * whether the invoice exists, whether the token expired or whether someone
 * revoked it. The rate limit is reported honestly because it is the one
 * denial a legitimate payer can act on by waiting.
 */
function bearerDenialToStartError(code: BearerDenialReason): AnchorStartErrorCode {
  return code === "RATE_LIMITED"
    ? ANCHOR_START_ERROR_CODE.RATE_LIMITED
    : ANCHOR_START_ERROR_CODE.PAYMENT_NOT_FOUND;
}

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
  | { success: true; data: { orderId: ProviderOrderId; anchorTxId: string } }
  | { success: false; error: AnchorStartError };

type StartAnchorTestOnrampResult =
  | {
      success: true;
      data: { orderId: ProviderOrderId; anchorTxId: string; hostedUrl: string };
    }
  | { success: false; error: AnchorStartError };

interface PollPixOnrampResult {
  orderId: ProviderOrderId;
  status: ProviderOrderStatus;
  terminal: boolean;
}

/**
 * Initiate a SEP-6 (programmatic) deposit against the agency's configured
 * anchor for the given chargeable invoice. Returns the persisted order;
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
    // The bearer token, never the invoice id. Authorizing on the id made
    // revocation advisory: the id is a durable handle the payer was already
    // handed, so anyone holding a stale one could keep starting real anchor
    // orders — which push a tenant CPF to the provider — after the link that
    // disclosed it had been revoked or had expired.
    invoiceAccessToken: v.string(),
    lang: v.optional(v.string()),
    // Optional for back-compat with the SEP-6 dispatch (testanchor doesn't
    // use it) and for callers that just want the first registered bank.
    // The etherfuse branch validates that the row belongs to the invoice's
    // agency before passing the upstream identifier to Etherfuse.
    bankAccountId: v.optional(v.id("agencyBankAccounts")),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        orderId: v.id("providerOrders"),
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
    const granted = await ctx.runMutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: args.invoiceAccessToken,
    });
    if (!granted.success) {
      return { success: false, error: { code: bearerDenialToStartError(granted.error.code) } };
    }
    const invoice = granted.data;

    if (!isChargeable(invoice.state)) {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.NOT_CHARGEABLE,
          detail: invoice.state.kind,
        },
      };
    }

    const providerName = await ctx.runQuery(
      internal.payments.providers.useCases.getProviderForAgency,
      {
        agencyId: invoice.agencyId,
      },
    );

    // Etherfuse uses a non-SEP REST flow. Dispatch before falling through
    // to the SEP-6 path so we never try to instantiate a SEP client for
    // a provider that doesn't speak the protocol.
    if (providerName === "etherfuse") {
      return startEtherfusePixOnramp(ctx, {
        invoiceId: invoice.invoiceId,
        agencyId: invoice.agencyId,
        amountBRLCents: invoice.totalCents,
        bankAccountId: args.bankAccountId,
      });
    }

    const providerEntry = getAnchorProvider(providerName);

    const client = createAnchorClient(providerName);
    await client.initialize();

    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const amount = brlCentsToAssetAmount(invoice.totalCents, "USDC");
    const tenant = await resolveTenantPrefill(ctx, {
      agencyId: invoice.agencyId,
      contractPublicId: invoice.firstContractPublicId ?? undefined,
    });

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

      const orderId = await ctx.runMutation(internal.payments.providers.orderUseCases.insertOrder, {
        agencyId: invoice.agencyId,
        invoiceId: invoice.invoiceId,
        provider: providerName,
        anchorTxId: response.id,
        instructions: response.instructions,
        how: response.how,
        status: PROVIDER_ORDER_STATUS.INCOMPLETE,
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
 * the `providerOrders` row with the latest SEP-24 transaction snapshot and,
 * on terminal `completed`, marks the parent invoice paid via
 * `markPaidByAnchor` (idempotent). Once the order is terminal, subsequent
 * polls short-circuit and return the order unchanged.
 */
export const pollPixOnramp = action({
  args: { orderId: v.id("providerOrders") },
  returns: v.object({
    orderId: v.id("providerOrders"),
    status: providerOrderStatusValidator,
    terminal: v.boolean(),
  }),
  handler: async (ctx, args): Promise<PollPixOnrampResult> => {
    const order = await ctx.runQuery(
      internal.payments.providers.orderUseCases.getOrderByIdInternal,
      {
        orderId: args.orderId,
      },
    );
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
        invoiceId: order.invoiceId,
      });
    }

    const client = createAnchorClient(order.provider);
    await client.initialize();
    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const tx = await client.sep6.getTransaction(order.anchorTxId);
    const status = normalizeSep24Status(tx.status);
    const orderPatch = {
      status,
      amountInCents: brlToCents(tx.amount_in),
      amountOutCents: brlToCents(tx.amount_out),
      feeCents: brlToCents(tx.amount_fee),
      completedAt: tx.completed_at,
      rawPayload: tx,
    };

    if (status === PROVIDER_ORDER_STATUS.COMPLETED) {
      // Order patch + invoice paid in one transaction — prevents the
      // order from flipping completed while leaving the invoice open
      // (which would short-circuit future polls at the isTerminal guard).
      await ctx.runMutation(internal.payments.providers.orderUseCases.completeOrderAndMarkPaid, {
        orderId: order._id,
        ...orderPatch,
        invoiceId: order.invoiceId,
        anchorTxId: order.anchorTxId,
        pixKey: tx.from ?? `anchor:${order.anchorTxId}`,
        paidAt: tx.completed_at ?? new Date().toISOString(),
      });
    } else {
      await ctx.runMutation(internal.payments.providers.orderUseCases.updateOrderStatus, {
        orderId: order._id,
        ...orderPatch,
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
    // Bearer token, not the invoice id — same reasoning as `startPixOnramp`.
    invoiceAccessToken: v.string(),
    lang: v.optional(v.string()),
  },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        orderId: v.id("providerOrders"),
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
    const granted = await ctx.runMutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: args.invoiceAccessToken,
    });
    if (!granted.success) {
      return { success: false, error: { code: bearerDenialToStartError(granted.error.code) } };
    }
    const invoice = granted.data;

    if (!isChargeable(invoice.state)) {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.NOT_CHARGEABLE,
          detail: invoice.state.kind,
        },
      };
    }

    const providerName = await ctx.runQuery(
      internal.payments.providers.useCases.getProviderForAgency,
      {
        agencyId: invoice.agencyId,
      },
    );

    const client = createAnchorClient(providerName);
    await client.initialize();

    const signer = getTreasurySigner();
    await client.authenticate(signer.publicKey, signer.sign);

    const amount = brlCentsToAssetAmount(invoice.totalCents, "USDC");
    const tenant = await resolveTenantPrefill(ctx, {
      agencyId: invoice.agencyId,
      contractPublicId: invoice.firstContractPublicId ?? undefined,
    });

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

      const orderId = await ctx.runMutation(internal.payments.providers.orderUseCases.insertOrder, {
        agencyId: invoice.agencyId,
        invoiceId: invoice.invoiceId,
        provider: providerName,
        anchorTxId: response.id,
        hostedUrl: response.url,
        status: PROVIDER_ORDER_STATUS.INCOMPLETE,
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
  args: { orderId: v.id("providerOrders") },
  returns: v.object({
    orderId: v.id("providerOrders"),
    status: providerOrderStatusValidator,
    terminal: v.boolean(),
  }),
  handler: async (ctx, args): Promise<PollPixOnrampResult> => {
    const order = await ctx.runQuery(
      internal.payments.providers.orderUseCases.getOrderByIdInternal,
      {
        orderId: args.orderId,
      },
    );
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

    await ctx.runMutation(internal.payments.providers.orderUseCases.updateOrderStatus, {
      orderId: order._id,
      status,
      amountInCents: brlToCents(tx.amount_in),
      amountOutCents: brlToCents(tx.amount_out),
      feeCents: brlToCents(tx.amount_fee),
      completedAt: tx.completed_at,
      rawPayload: tx,
    });

    if (status === PROVIDER_ORDER_STATUS.COMPLETED) {
      const pixKey = tx.from ?? `anchor:${order.anchorTxId}`;
      const paidAt = tx.completed_at ?? new Date().toISOString();
      await ctx.runMutation(internal.invoices.mutations.markPaidByAnchor, {
        invoiceId: order.invoiceId,
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
  accountId: AnchorAccountId;
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
    const existing = await ctx.runQuery(
      internal.payments.providers.accountUseCases.getByAgencyAndProvider,
      {
        agencyId: args.agencyId,
        provider: "etherfuse",
      },
    );
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
    let accountId: AnchorAccountId;
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
      accountId = await ctx.runMutation(
        internal.payments.providers.accountUseCases.insertEtherfuseAccount,
        {
          agencyId: args.agencyId,
          customerId: randomUUID(),
          bankAccountId: randomUUID(),
          publicKey,
          encryptedSecret,
        },
      );
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

    await ctx.runMutation(
      internal.payments.providers.accountUseCases.markEtherfuseProvisioningHash,
      {
        accountId,
        provisioningTxHash: transactionHash,
      },
    );

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

/**
 * Wrap an Etherfuse client call so a "this was already done" 4xx
 * doesn't break onboarding retry. The vendored client surfaces these as
 * AnchorError with statusCode 409 (Etherfuse's "already submitted" /
 * "already accepted") or message text containing "already". Anything
 * else rethrows.
 */
async function tolerateAlreadyDone<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AnchorError) {
      const looksAlreadyDone =
        err.statusCode === 409 || err.message.toLowerCase().includes("already");
      if (looksAlreadyDone) {
        // The vendor's 409 text routinely embeds the customer it collided on
        // ("customer with email … already exists"), so it goes through the
        // redactor as context rather than interpolated into the message.
        logWarn("[etherfuse] step already done, continuing", { label, error: err });
        return null;
      }
    }
    throw err;
  }
}

// ─── Etherfuse agency onboarding (provision + KYC/KYB + terms) ────────────────

type OnboardAgencyEtherfuseContactPerson = {
  givenName: string;
  familyName: string;
  dateOfBirth: string;
};

type OnboardAgencyEtherfuseAddress = {
  street: string;
  city: string;
  region: string;
  postalCode: string;
};

type OnboardAgencyEtherfuseResult = {
  accountId: AnchorAccountId;
  publicKey: string;
  customerId: string;
  kycStatus: string;
};

const contactPersonValidator = v.object({
  givenName: v.string(),
  familyName: v.string(),
  dateOfBirth: v.string(),
});

const addressValidator = v.object({
  street: v.string(),
  city: v.string(),
  region: v.string(),
  postalCode: v.string(),
});

const onboardingReturnValidator = v.object({
  accountId: v.id("anchorAccounts"),
  publicKey: v.string(),
  customerId: v.string(),
  kycStatus: v.string(),
});

/**
 * Shared body for both KYC (personal) and KYB (business) onboarding —
 * the only difference between them is which idNumber gets submitted in
 * the KYC payload (CPF vs CNPJ). Everything else (provisioning, terms,
 * approval mutation, idempotency) is identical.
 */
async function performEtherfuseOnboarding(
  ctx: ActionCtx,
  args: {
    agencyId: AgencyId;
    contactPerson: OnboardAgencyEtherfuseContactPerson;
    address: OnboardAgencyEtherfuseAddress;
    idNumber: { value: string; type: "CPF" | "CNPJ" };
  },
): Promise<OnboardAgencyEtherfuseResult> {
  // Step 1: provision Stellar proxy account (idempotent). Discard the
  // return value — we re-read the row in Step 2 to also handle the
  // already-provisioned case uniformly.
  await ctx.runAction(internal.payments.providers.actions.provisionAgencyEtherfuseAccount, {
    agencyId: args.agencyId,
  });

  // Step 2: load the row we just wrote (or already had) for UUIDs.
  const account = await ctx.runQuery(
    internal.payments.providers.accountUseCases.getByAgencyAndProvider,
    {
      agencyId: args.agencyId,
      provider: "etherfuse",
    },
  );
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

  const customerId = account.externalId;
  if (!customerId) {
    throw new Error(`anchorAccounts ${account._id} has null externalId`);
  }
  const { bankAccountId, publicKey } = account.data;

  // Step 3: instantiate client + register the trio with Etherfuse.
  // EtherfuseClient is imported lazily to keep startup-cost out of the
  // hot path for actions that don't touch Etherfuse.
  const { EtherfuseClient } = await import("../../../apps/agency/src/lib/anchors/etherfuse/index");
  const client = new EtherfuseClient({
    apiKey: getEtherfuseApiKey(),
    baseUrl: getEtherfuseBaseUrl(),
    defaultBlockchain: "stellar",
  });
  const presignedUrl = await client.getKycUrl(customerId, publicKey, bankAccountId);

  // Step 4: programmatic KYC submission. Sandbox auto-approves with the
  // nested-id payload below; production gates on document review.
  // Tolerate duplicate-submission errors so a mid-flow failure in a
  // previous run (e.g. terms acceptance throwing after KYC succeeded)
  // can be retried without manual cleanup.
  await tolerateAlreadyDone(
    () =>
      client.submitKycIdentity(customerId, {
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
              value: args.idNumber.value,
              type: args.idNumber.type,
            },
          ],
        },
      }),
    "submitKycIdentity",
  );

  // Step 5: terms acceptance. Single endpoint suffices for sandbox; full
  // 3-agreement flow (acceptAgreements) is gated by phone-number collection
  // which is a production-only concern.
  await tolerateAlreadyDone(
    () => client.acceptTermsAndConditions(presignedUrl),
    "acceptTermsAndConditions",
  );

  // Step 6: flip the row's onboarding status + kyc state in one
  // transaction — see markEtherfuseOnboardingApproved.
  await ctx.runMutation(
    internal.payments.providers.accountUseCases.markEtherfuseOnboardingApproved,
    {
      accountId: account._id,
    },
  );

  return {
    accountId: account._id,
    publicKey,
    customerId,
    kycStatus: "approved",
  };
}

/**
 * Full agency onboarding via KYB (business) — submits the agency's CNPJ
 * as the idNumber. Etherfuse routes this to the business verification
 * pipeline. Requires the partner account to have KYB enabled; sandbox
 * currently rejects with "Proxy account not found" on the first /ramp/order
 * call when KYB isn't enabled — use the KYC variant for sandbox testing
 * until KYB access is granted.
 */
export const onboardAgencyEtherfuseKyb = internalAction({
  args: {
    agencyId: v.id("agencies"),
    contactPerson: contactPersonValidator,
    address: addressValidator,
  },
  returns: onboardingReturnValidator,
  handler: async (ctx, args): Promise<OnboardAgencyEtherfuseResult> => {
    const agency = await ctx.runQuery(internal.agencies.useCases.getById, {
      agencyId: args.agencyId,
    });
    if (!agency) throw new Error(`Agency ${args.agencyId} not found`);
    if (!agency.cnpj) {
      throw new Error(
        `Agency ${args.agencyId} has no CNPJ — Etherfuse KYB is for legal entities. ` +
          `Autonomo agencies (CPF only) must use KYC, not this action.`,
      );
    }
    return performEtherfuseOnboarding(ctx, {
      agencyId: args.agencyId,
      contactPerson: args.contactPerson,
      address: args.address,
      idNumber: { value: agency.cnpj, type: "CNPJ" },
    });
  },
});

/**
 * Full agency onboarding via KYC (personal) — submits the contact
 * person's CPF as the idNumber. Etherfuse routes this to the personal
 * verification pipeline, which sandbox + most production partner
 * accounts have enabled by default. Legally the contact person becomes
 * the customer-of-record for Etherfuse purposes; the agency's proxy
 * account is the destination wallet either way.
 */
export const onboardAgencyEtherfuseKyc = internalAction({
  args: {
    agencyId: v.id("agencies"),
    contactPerson: contactPersonValidator,
    address: addressValidator,
    cpf: v.string(),
  },
  returns: onboardingReturnValidator,
  handler: async (ctx, args): Promise<OnboardAgencyEtherfuseResult> => {
    return performEtherfuseOnboarding(ctx, {
      agencyId: args.agencyId,
      contactPerson: args.contactPerson,
      address: args.address,
      idNumber: { value: args.cpf, type: "CPF" },
    });
  },
});

// ─── Etherfuse bank account management ────────────────────────────────────────

type BankAccountSummary = {
  type: "pix" | "spei";
  accountHolderName: string;
  accountNumberLast4: string;
};

// Returned to an unauthenticated payer, so it mirrors the tenant-visible
// projection in `bankAccountUseCases`: enough to recognize the account, never
// enough to reconstruct it.
const bankAccountSummaryValidator = v.object({
  type: v.union(v.literal("pix"), v.literal("spei")),
  accountHolderName: v.string(),
  accountNumberLast4: v.string(),
});

const ETHERFUSE_HOSTED_URL_TTL_SECONDS = 900;

type EtherfuseManageBankErrorCode = "NO_ANCHOR_ACCOUNT" | "KYC_NOT_APPROVED" | "INTERNAL";

const etherfuseManageBankErrorCodeValidator = v.union(
  v.literal("NO_ANCHOR_ACCOUNT"),
  v.literal("KYC_NOT_APPROVED"),
  v.literal("INTERNAL"),
);

type SyncEtherfuseBankAccountsResult =
  | { success: true; data: { count: number; accounts: BankAccountSummary[] } }
  | { success: false; error: { code: EtherfuseManageBankErrorCode; detail?: string } };

type GetEtherfuseBankRegistrationUrlResult =
  | { success: true; data: { presignedUrl: string; expiresInSeconds: number } }
  | {
      success: false;
      error: { code: Exclude<EtherfuseManageBankErrorCode, "KYC_NOT_APPROVED">; detail?: string };
    };

/**
 * Pull the agency's Etherfuse-side bank list and reconcile it with the
 * local `agencyBankAccounts` mirror. Idempotent — upserts new rows,
 * patches changed ones, and removes any local row whose upstream id
 * disappeared (operator deleted a bank in Etherfuse's hosted UI).
 *
 * Called by the checkout pre-flight after the operator clicks
 * "Já cadastrei" to refresh the picker, and on any other UI moment we
 * want to re-mirror.
 */
export const syncEtherfuseBankAccounts = action({
  // The payer is unauthenticated, so the agency is resolved from the invoice
  // bearer token server-side. Accepting `agencyId` from the client made this
  // an IDOR: any caller could name any agency and read back its Etherfuse
  // bank accounts, full account numbers included.
  args: { invoiceAccessToken: v.string() },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        count: v.number(),
        accounts: v.array(bankAccountSummaryValidator),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.object({
        code: etherfuseManageBankErrorCodeValidator,
        detail: v.optional(v.string()),
      }),
    }),
  ),
  handler: async (ctx, args): Promise<SyncEtherfuseBankAccountsResult> => {
    const granted = await ctx.runMutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: args.invoiceAccessToken,
    });
    if (!granted.success) {
      return { success: false, error: { code: "NO_ANCHOR_ACCOUNT" } };
    }
    const account = await ctx.runQuery(
      internal.payments.providers.accountUseCases.getByAgencyAndProvider,
      {
        agencyId: granted.data.agencyId,
        provider: "etherfuse",
      },
    );
    if (!account || account.data.provider !== "etherfuse" || !account.externalId) {
      return { success: false, error: { code: "NO_ANCHOR_ACCOUNT" } };
    }
    if (account.data.kycStatus !== "approved") {
      return {
        success: false,
        error: {
          code: "KYC_NOT_APPROVED",
          detail: `kycStatus=${account.data.kycStatus}`,
        },
      };
    }

    const { EtherfuseClient } =
      await import("../../../apps/agency/src/lib/anchors/etherfuse/index");
    const client = new EtherfuseClient({
      apiKey: getEtherfuseApiKey(),
      baseUrl: getEtherfuseBaseUrl(),
      defaultBlockchain: "stellar",
    });

    let upstream;
    try {
      upstream = await client.getFiatAccounts(account.externalId);
    } catch (err: unknown) {
      if (err instanceof Error) {
        return { success: false, error: { code: "INTERNAL", detail: err.message } };
      }
      throw err;
    }

    // Mutav-BR only consumes Pix today. Filter out non-pix entries (the
    // sandbox account may carry test SPEI banks from earlier experiments)
    // so the local picker can't accidentally select a Mexican rail.
    const pixOnly = upstream.filter((a) => a.type === "PIX");

    // `summaries` is what the payer sees; `syncedExternalIds` stays server-side
    // because the Etherfuse identifier is not the payer's business.
    const summaries: BankAccountSummary[] = [];
    const syncedExternalIds: string[] = [];
    for (const remote of pixOnly) {
      syncedExternalIds.push(remote.id);
      await ctx.runMutation(internal.payments.providers.bankAccountUseCases.upsertFromEtherfuse, {
        agencyId: granted.data.agencyId,
        anchorAccountId: account._id,
        externalBankAccountId: remote.id,
        type: "pix",
        accountNumber: remote.accountNumber,
        accountHolderName: remote.accountHolderName,
        etherfuseCreatedAt: remote.createdAt,
      });
      summaries.push({
        type: "pix",
        accountHolderName: remote.accountHolderName,
        accountNumberLast4: remote.accountNumber.slice(-4),
      });
    }
    await ctx.runMutation(
      internal.payments.providers.bankAccountUseCases.removeMissingExternalIds,
      {
        agencyId: granted.data.agencyId,
        keepExternalIds: syncedExternalIds,
      },
    );

    return { success: true, data: { count: summaries.length, accounts: summaries } };
  },
});

/**
 * Return a fresh presigned URL the operator opens in a new tab to add
 * a Pix bank via Etherfuse's hosted onboarding flow. Each invocation
 * passes a fresh placeholder `bankAccountId` so the hosted UI treats
 * the visit as a distinct new-bank registration; the upstream creates
 * the actual bank entry only when the operator completes the form.
 * URLs expire after 15 min per Etherfuse — surface that so the caller
 * can decide when to re-fetch.
 */
export const getEtherfuseBankRegistrationUrl = action({
  // The payer is unauthenticated, so the agency is resolved from the invoice
  // bearer token server-side. Accepting `agencyId` from the client made this
  // an IDOR: any caller could name any agency and read back its Etherfuse
  // bank accounts, full account numbers included.
  args: { invoiceAccessToken: v.string() },
  returns: v.union(
    v.object({
      success: v.literal(true),
      data: v.object({
        presignedUrl: v.string(),
        expiresInSeconds: v.number(),
      }),
    }),
    v.object({
      success: v.literal(false),
      error: v.object({
        code: v.union(v.literal("NO_ANCHOR_ACCOUNT"), v.literal("INTERNAL")),
        detail: v.optional(v.string()),
      }),
    }),
  ),
  handler: async (ctx, args): Promise<GetEtherfuseBankRegistrationUrlResult> => {
    const granted = await ctx.runMutation(internal.invoices.mutations.consumeBearerAccess, {
      accessToken: args.invoiceAccessToken,
    });
    if (!granted.success) {
      return { success: false, error: { code: "NO_ANCHOR_ACCOUNT" } };
    }
    const account = await ctx.runQuery(
      internal.payments.providers.accountUseCases.getByAgencyAndProvider,
      {
        agencyId: granted.data.agencyId,
        provider: "etherfuse",
      },
    );
    if (!account || account.data.provider !== "etherfuse" || !account.externalId) {
      return { success: false, error: { code: "NO_ANCHOR_ACCOUNT" } };
    }

    const { EtherfuseClient } =
      await import("../../../apps/agency/src/lib/anchors/etherfuse/index");
    const client = new EtherfuseClient({
      apiKey: getEtherfuseApiKey(),
      baseUrl: getEtherfuseBaseUrl(),
      defaultBlockchain: "stellar",
    });

    try {
      const presignedUrl = await client.getKycUrl(
        account.externalId,
        account.data.publicKey,
        randomUUID(),
      );
      return {
        success: true,
        data: { presignedUrl, expiresInSeconds: ETHERFUSE_HOSTED_URL_TTL_SECONDS },
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return { success: false, error: { code: "INTERNAL", detail: err.message } };
      }
      throw err;
    }
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
function normalizeEtherfuseStatus(status: AnchorTransactionStatus): ProviderOrderStatus {
  switch (status) {
    case "pending":
      return PROVIDER_ORDER_STATUS.PENDING_USER_TRANSFER_START;
    case "processing":
      return PROVIDER_ORDER_STATUS.PENDING_ANCHOR;
    case "completed":
      return PROVIDER_ORDER_STATUS.COMPLETED;
    case "failed":
    case "cancelled":
      return PROVIDER_ORDER_STATUS.ERROR;
    case "expired":
      return PROVIDER_ORDER_STATUS.EXPIRED;
    case "refunded":
      return PROVIDER_ORDER_STATUS.REFUNDED;
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
  invoiceId: InvoiceId;
  agencyId: AgencyId;
  amountBRLCents: number;
  bankAccountId?: AgencyBankAccountId;
};

async function startEtherfusePixOnramp(
  ctx: ActionCtx,
  context: EtherfuseStartContext,
): Promise<StartPixOnrampResult> {
  const account = await ctx.runQuery(
    internal.payments.providers.accountUseCases.getByAgencyAndProvider,
    {
      agencyId: context.agencyId,
      provider: "etherfuse",
    },
  );
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

  // Resolve which agency bank account funds the Pix. Explicit pick from
  // the client preferred; falls back to the first registered bank when
  // the caller doesn't care (e.g. testanchor → etherfuse dispatch).
  // Both paths exit early with NO_BANK_ACCOUNT if the agency hasn't
  // registered any bank yet — surfacing the gap cleanly instead of
  // letting Etherfuse return its opaque "Proxy account not found".
  let externalBankAccountId: string;
  if (context.bankAccountId) {
    const bank = await ctx.runQuery(internal.payments.providers.bankAccountUseCases.getById, {
      bankAccountId: context.bankAccountId,
    });
    if (!bank || bank.agencyId !== context.agencyId) {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.NO_BANK_ACCOUNT,
          detail: "selected bank account not found for this agency",
        },
      };
    }
    externalBankAccountId = bank.externalBankAccountId;
  } else {
    const banks = await ctx.runQuery(
      internal.payments.providers.bankAccountUseCases.listByAgencyInternal,
      {
        agencyId: context.agencyId,
      },
    );
    if (banks.length === 0) {
      return {
        success: false,
        error: { code: ANCHOR_START_ERROR_CODE.NO_BANK_ACCOUNT },
      };
    }
    // Deterministic ordering: by_agency index returns by _creationTime
    // asc, so [0] is the agency's oldest registered bank.
    externalBankAccountId = banks[0]!.externalBankAccountId;
  }

  const { EtherfuseClient } = await import("../../../apps/agency/src/lib/anchors/etherfuse/index");
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
      bankAccountId: externalBankAccountId,
      stellarAddress: account.data.publicKey,
      amount: amountBRL,
      fromCurrency: "BRL",
      toCurrency: "TESOURO",
    });

    // Etherfuse's /ramp/order create response sometimes ships without
    // populated Pix payment details (depositPixCode / depositPixKey
    // arrive a moment later). Retry once via GET so the UI doesn't
    // render an empty QR. The poller would catch up eventually, but
    // forcing a populated insert keeps the UX deterministic.
    let paymentInstructions = onramp.paymentInstructions;
    if (!paymentInstructions || paymentInstructions.type !== "pix") {
      const tx = await client.getOnRampTransaction(onramp.id);
      paymentInstructions = tx?.paymentInstructions;
    }

    if (!paymentInstructions || paymentInstructions.type !== "pix") {
      return {
        success: false,
        error: {
          code: ANCHOR_START_ERROR_CODE.ANCHOR_RESPONSE_INVALID,
          detail: `expected pix instructions, got ${paymentInstructions?.type ?? "none"}`,
        },
      };
    }

    const orderId = await ctx.runMutation(internal.payments.providers.orderUseCases.insertOrder, {
      agencyId: context.agencyId,
      invoiceId: context.invoiceId,
      provider: "etherfuse",
      anchorTxId: onramp.id,
      instructions: etherfusePixInstructions(paymentInstructions),
      status: PROVIDER_ORDER_STATUS.PENDING_USER_TRANSFER_START,
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
  order: { _id: ProviderOrderId; anchorTxId: string; invoiceId: InvoiceId },
): Promise<PollPixOnrampResult> {
  const { EtherfuseClient } = await import("../../../apps/agency/src/lib/anchors/etherfuse/index");
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
    await ctx.runMutation(internal.payments.providers.orderUseCases.updateOrderStatus, {
      orderId: order._id,
      status: PROVIDER_ORDER_STATUS.ERROR,
    });
    return { orderId: order._id, status: PROVIDER_ORDER_STATUS.ERROR, terminal: true };
  }

  const status = normalizeEtherfuseStatus(tx.status);
  const terminal = isTerminal(status);
  const orderPatch = {
    status,
    // completedAt is the timestamp of terminal resolution, not the last
    // update — only write it when the order has actually settled.
    completedAt: terminal ? tx.updatedAt : undefined,
    rawPayload: tx,
  };

  if (status === PROVIDER_ORDER_STATUS.COMPLETED) {
    const pixKey =
      tx.paymentInstructions?.type === "pix" && tx.paymentInstructions.pixKey
        ? tx.paymentInstructions.pixKey
        : `etherfuse:${order.anchorTxId}`;
    // Order patch + invoice paid in one transaction — see SEP-6 branch
    // for why splitting these breaks retry semantics.
    await ctx.runMutation(internal.payments.providers.orderUseCases.completeOrderAndMarkPaid, {
      orderId: order._id,
      ...orderPatch,
      invoiceId: order.invoiceId,
      anchorTxId: order.anchorTxId,
      pixKey,
      paidAt: tx.updatedAt ?? new Date().toISOString(),
    });
  } else {
    await ctx.runMutation(internal.payments.providers.orderUseCases.updateOrderStatus, {
      orderId: order._id,
      ...orderPatch,
    });
  }

  return { orderId: order._id, status, terminal };
}
