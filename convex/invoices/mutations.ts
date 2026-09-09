import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "../_generated/server";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { mutationWithAgencyScope } from "../lib/auth";
import type { Result } from "../lib/result";
import { SettlementMethods } from "../payments/domain";
import { recordSettlement } from "../payments/settlement";
import { generateInvoiceAccessToken } from "../lib/randomId";
import type { AgencyId } from "../agencies/domain";
import { INSURED_STATES, type Guarantee, type GuaranteeId } from "../guarantees/domain";
import {
  accessTokenExpiryFrom,
  INVOICE_LINE_ITEM_KIND,
  InvoiceStates,
  settledAccessTokenExpiry,
  type BearerDenialReason,
  type InvoiceId,
  type InvoiceState,
} from "./domain";
import { consumeBearerInvoice } from "./lib/accessToken";
import { allocateInvoiceDocumentNumber } from "./lib/documentNumber";
import { generateInvoiceMuxedId } from "./lib/muxedId";

type BearerGrant = {
  invoiceId: InvoiceId;
  agencyId: AgencyId;
  totalCents: number;
  state: InvoiceState;
  firstGuaranteePublicId: string | null;
};

type BearerAccessErrorResult = { code: BearerDenialReason };

/** The only refusal the unauthenticated surface is allowed to distinguish. */
type BearerPageViewErrorResult = { code: "DENIED" };

/**
 * Server-rendered checkout entry gate. `apps/pay` calls this once per page
 * load, and the token is the only thing it sends: this is a public mutation,
 * so any client-supplied identifier is chosen by the caller, not observed.
 *
 * Every refusal collapses to one opaque `DENIED`. The specific reason is real
 * and is used inside the resolver, but returning it here would tell an
 * unauthenticated caller whether a token merely expired — and so was issued
 * once — or was never issued at all. That is an existence oracle over the
 * token space, and the same leak the read paths already refuse to emit.
 */
export const recordBearerPageView = mutation({
  args: { accessToken: v.string() },
  handler: async (ctx, args): Promise<Result<object, BearerPageViewErrorResult>> => {
    const resolved = await consumeBearerInvoice(ctx, {
      accessToken: args.accessToken,
      nowMs: Date.now(),
    });
    if (!resolved.success) {
      return { success: false, error: { code: "DENIED" }, message: "Bearer access denied" };
    }
    return { success: true, data: {}, message: "Bearer access granted" };
  },
});

/**
 * The write-path bearer gate every unauthenticated checkout action goes
 * through. A mutation rather than a query because the rate limiter has to
 * count the attempt, and because the only honest place to spend a bearer
 * credential is a context that can record that it was spent.
 *
 * Returns the fields the checkout actions need and nothing else — notably not
 * the token, and not the raw document, so an action cannot re-widen the
 * unauthenticated surface by forwarding what it was handed.
 */
export const consumeBearerAccess = internalMutation({
  args: { accessToken: v.string() },
  handler: async (ctx, args): Promise<Result<BearerGrant, BearerAccessErrorResult>> => {
    const resolved = await consumeBearerInvoice(ctx, {
      accessToken: args.accessToken,
      nowMs: Date.now(),
    });
    if (!resolved.success) return resolved;

    const { invoice } = resolved.data;
    return {
      success: true,
      data: {
        invoiceId: invoice._id,
        agencyId: invoice.agencyId,
        totalCents: invoice.totalCents,
        state: invoice.state,
        firstGuaranteePublicId: invoice.lineItems[0]?.guaranteePublicId ?? null,
      },
      message: "Bearer access granted",
    };
  },
});

/**
 * Kill a checkout link that has gone somewhere it should not have — forwarded
 * into a group chat, pasted into a support ticket. Effective on the next
 * request against any bearer entry point.
 */
export const revokeAccessToken = mutationWithAgencyScope({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.agencyId !== ctx.agencyId) {
      return { success: false as const, error: { code: "INVOICE_NOT_FOUND" as const } };
    }
    await ctx.db.patch(invoice._id, { accessTokenRevokedAt: Date.now() });
    // Killing the credential that gates a named tenant's bill is exactly the
    // act that has to leave a trail. The token itself never enters the
    // payload — the whole point is that it stops being usable.
    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.INVOICE_ACCESS_REVOKED,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: { invoiceId: invoice._id, agencyId: invoice.agencyId },
    });
    return { success: true as const, data: { publicId: invoice.publicId } };
  },
});

/**
 * Issue a fresh credential for the same invoice, clearing any revocation and
 * restarting the TTL. The point of rotation is that a leaked link can be
 * replaced without voiding and reissuing the bill the tenant still owes.
 */
export const rotateAccessToken = mutationWithAgencyScope({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.agencyId !== ctx.agencyId) {
      return { success: false as const, error: { code: "INVOICE_NOT_FOUND" as const } };
    }
    const accessToken = generateInvoiceAccessToken();
    await ctx.db.patch(invoice._id, {
      accessToken,
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
      accessTokenRevokedAt: undefined,
    });
    await appendAuditEntry(ctx, {
      actor: { kind: "user", userId: ctx.user._id },
      action: AUDIT_ACTION.INVOICE_ACCESS_ROTATED,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: { invoiceId: invoice._id, agencyId: invoice.agencyId },
    });
    return { success: true as const, data: { accessToken } };
  },
});

type BillingLineItem = {
  guaranteeId: GuaranteeId;
  guaranteePublicId: string;
  kind: "recurring" | "activation";
  amountCents: number;
  description: string;
};

/**
 * Every guarantee the agency is billed for this period: one read per insured
 * state through `by_agency_status`. The insured states are not lexically
 * contiguous (`active < closed < cover_committed < …`), so a single index
 * range would fold drafts and closed guarantees into the bill.
 */
async function collectInsuredGuarantees(
  ctx: { db: Pick<MutationCtx["db"], "query"> },
  agencyId: AgencyId,
): Promise<Guarantee[]> {
  const perState = await Promise.all(
    INSURED_STATES.map((status) =>
      ctx.db
        .query("guarantees")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId).eq("status", status))
        .collect(),
    ),
  );
  return perState.flat();
}

function activatedWithin(
  guarantee: Guarantee,
  period: { startMs: number; endMs: number },
): boolean {
  if (guarantee.activatedAt === null) return false;
  const activatedMs = Date.parse(guarantee.activatedAt);
  return activatedMs >= period.startMs && activatedMs < period.endMs;
}

/**
 * Generate one `invoices` record per agency for the given billing period.
 *
 * Rules:
 * - Every in-force guarantee (any `INSURED_STATES` member) contributes a
 *   `recurring` line item (`terms.feeCents`) — a guarantee in arrears or under
 *   cover is still insured and still billed.
 * - Guarantees whose `activatedAt` falls within the period also get an
 *   `activation` line item (`terms.oneTimeActivationFeeCents`).
 * - Idempotent: skips agencies that already have a record for the period.
 * - `state` starts as `open`; the payment method is derived from the
 *   settlement row once the invoice is paid.
 * - `dueDate` is always the 10th of the billing month.
 *
 * Call manually:
 *   bunx convex run invoices/mutations:generateMonthlyInvoices '{"periodMonth":"2026-05"}'
 */
export const generateMonthlyInvoices = internalMutation({
  args: { periodMonth: v.string() },
  handler: async (ctx, { periodMonth }) => {
    // Period boundaries (UTC ms) — used to detect newly activated guarantees.
    const [yearStr, monthStr] = periodMonth.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const period = { startMs: Date.UTC(year, month - 1, 1), endMs: Date.UTC(year, month, 1) };

    const dueDate = `${periodMonth}-10`;
    const issuedAt = new Date().toISOString().slice(0, 10);

    const agencies = await ctx.db.query("agencies").collect();

    type Result =
      | { agencyId: string; skipped: true }
      | { agencyId: string; invoiceId: string; totalCents: number; lineItemCount: number };

    const results: Result[] = [];

    for (const agency of agencies) {
      // ── Idempotency check ──────────────────────────────────────────────────
      const existing = await ctx.db
        .query("invoices")
        .withIndex("by_agency_period", (q) =>
          q.eq("agencyId", agency._id).eq("periodMonth", periodMonth),
        )
        .unique();

      if (existing !== null) {
        results.push({ agencyId: agency._id, skipped: true });
        continue;
      }

      // ── Collect in-force guarantees ────────────────────────────────────────
      const insuredGuarantees = await collectInsuredGuarantees(ctx, agency._id);

      const lineItems: BillingLineItem[] = [];

      for (const guarantee of insuredGuarantees) {
        // Recurring fee — every in-force guarantee, priced by its own terms snapshot.
        lineItems.push({
          guaranteeId: guarantee._id,
          guaranteePublicId: guarantee.publicId,
          kind: INVOICE_LINE_ITEM_KIND.RECURRING,
          amountCents: guarantee.terms.feeCents,
          description: `Mensalidade — garantia ${guarantee.publicId}`,
        });

        // Activation fee — guarantees first activated within this billing period.
        if (activatedWithin(guarantee, period) && guarantee.terms.oneTimeActivationFeeCents > 0) {
          lineItems.push({
            guaranteeId: guarantee._id,
            guaranteePublicId: guarantee.publicId,
            kind: INVOICE_LINE_ITEM_KIND.ACTIVATION,
            amountCents: guarantee.terms.oneTimeActivationFeeCents,
            description: `Taxa de ativação — garantia ${guarantee.publicId}`,
          });
        }
      }

      const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

      const publicId = await allocateInvoiceDocumentNumber(ctx, agency);

      const invoiceId = await ctx.db.insert("invoices", {
        agencyId: agency._id,
        publicId,
        accessToken: generateInvoiceAccessToken(),
        accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
        periodMonth,
        issuedAt,
        dueDate,
        totalCents,
        state: InvoiceStates.open(),
        muxedId: generateInvoiceMuxedId(),
        lineItems,
      });

      results.push({
        agencyId: agency._id,
        invoiceId,
        totalCents,
        lineItemCount: lineItems.length,
      });

      await appendAuditEntry(ctx, {
        actor: { kind: "system", source: "cron_monthly_billing" },
        action: AUDIT_ACTION.INVOICE_BATCH_GENERATED,
        resourceType: "invoices",
        resourceId: publicId,
        payload: {
          invoiceId,
          agencyId: agency._id,
          periodMonth,
          totalCents,
          lineItemCount: lineItems.length,
        },
      });
    }

    return results;
  },
});

/**
 * Idempotent mark-as-paid. Called by the Horizon reconciler when an
 * incoming Stellar payment matches an open invoice's muxed-id.
 *
 * No-ops if the invoice is already paid with the same txHash (re-runs
 * after restart are safe). Records the muxed `M…` destination + tx hash
 * on the settlement row and moves state to `paid` with the observed timestamp.
 */
export const markPaidByTx = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    txHash: v.string(),
    paidAt: v.string(),
    muxedAddress: v.string(),
  },
  handler: async (ctx, { invoiceId, txHash, paidAt, muxedAddress }) => {
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return { invoiceId, status: "not_found" as const };

    if (invoice.state.kind === "paid") {
      const existing = await ctx.db
        .query("payments")
        .withIndex("by_externalRef", (q) => q.eq("externalRef", txHash))
        .first();
      return existing
        ? { invoiceId, status: "already_paid" as const }
        : { invoiceId, status: "duplicate_inbound" as const };
    }

    // Settlement puts the credential on its own, shorter clock: the link's
    // remaining job is the receipt, not the payment.
    await ctx.db.patch(invoiceId, {
      state: InvoiceStates.paid(paidAt),
      accessTokenExpiresAt: settledAccessTokenExpiry(invoice.accessTokenExpiresAt, Date.now()),
    });

    await recordSettlement(ctx, {
      agencyId: invoice.agencyId,
      invoiceId,
      status: "succeeded",
      amountCents: invoice.totalCents,
      paidAt,
      externalRef: txHash,
      method: SettlementMethods.stellar(muxedAddress, txHash),
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "stellar_indexer" },
      action: AUDIT_ACTION.INVOICE_PAID,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: {
        invoiceId,
        agencyId: invoice.agencyId,
        method: "stellar",
        txHash,
        paidAt,
      },
    });

    return { invoiceId, status: "paid" as const };
  },
});

/**
 * Idempotent mark-as-paid for anchor-mediated on-ramps (e.g. testanchor /
 * Etherfuse Pix). Called from `pollPixOnramp` when the underlying anchor
 * order reaches `completed`.
 *
 * No-ops if the invoice is already paid via the same anchor txId. Records
 * the anchor's reported PIX key + anchor transaction ID on the settlement
 * row and moves state to `paid` with the observed timestamp.
 */
export const markPaidByAnchor = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    anchorTxId: v.string(),
    pixKey: v.string(),
    paidAt: v.string(),
  },
  handler: async (ctx, { invoiceId, anchorTxId, pixKey, paidAt }) => {
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return { invoiceId, status: "not_found" as const };

    if (invoice.state.kind === "paid") {
      const existing = await ctx.db
        .query("payments")
        .withIndex("by_externalRef", (q) => q.eq("externalRef", anchorTxId))
        .first();
      return existing
        ? { invoiceId, status: "already_paid" as const }
        : { invoiceId, status: "duplicate_inbound" as const };
    }

    await ctx.db.patch(invoiceId, {
      state: InvoiceStates.paid(paidAt),
      accessTokenExpiresAt: settledAccessTokenExpiry(invoice.accessTokenExpiresAt, Date.now()),
    });

    await recordSettlement(ctx, {
      agencyId: invoice.agencyId,
      invoiceId,
      status: "succeeded",
      amountCents: invoice.totalCents,
      paidAt,
      externalRef: anchorTxId,
      method: SettlementMethods.pix(pixKey, anchorTxId),
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "anchor_webhook" },
      action: AUDIT_ACTION.INVOICE_PAID,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: {
        invoiceId,
        agencyId: invoice.agencyId,
        method: "pix",
        anchorTxId,
        paidAt,
      },
    });

    return { invoiceId, status: "paid" as const };
  },
});

/**
 * Dev-only: flip an invoice back to `open`. Used to
 * rerun the demo flow against an already-paid invoice. The Horizon cursor
 * is not rewound, so the original tx is NOT re-discovered — only NEW
 * incoming payments to the muxed address re-mark this invoice paid.
 *
 *   bunx convex run invoices/mutations:resetInvoiceToOpen '{"publicId":"INV-TEST-001"}'
 */
export const resetInvoiceToOpen = internalMutation({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
    if (!invoice) throw new Error(`Invoice ${publicId} not found`);
    const previousState = invoice.state.kind;
    // Reopening puts the credential back on the issuance clock — otherwise the
    // demo invoice comes back payable behind a link that already expired on the
    // settlement grace.
    await ctx.db.patch(invoice._id, {
      state: InvoiceStates.open(),
      accessTokenExpiresAt: accessTokenExpiryFrom(Date.now()),
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "dev_reset" },
      action: AUDIT_ACTION.INVOICE_RESET,
      resourceType: "invoices",
      resourceId: publicId,
      payload: {
        invoiceId: invoice._id,
        agencyId: invoice.agencyId,
        previousState,
      },
    });

    return { publicId, previousState };
  },
});

/**
 * Persist the latest Horizon paging token for a treasury account, so the
 * next polling tick resumes after the last processed record.
 */
export const setStellarIndexCursor = internalMutation({
  args: { sourceAccount: v.string(), cursor: v.string() },
  handler: async (ctx, { sourceAccount, cursor }) => {
    const lastRunAt = new Date().toISOString();
    const existing = await ctx.db
      .query("stellarIndexState")
      .withIndex("by_sourceAccount", (q) => q.eq("sourceAccount", sourceAccount))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { cursor, lastRunAt });
      return existing._id;
    }
    return ctx.db.insert("stellarIndexState", { sourceAccount, cursor, lastRunAt });
  },
});
