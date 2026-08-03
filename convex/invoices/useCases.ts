import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { assertAgencyAccess, queryWithAgencyScope } from "../lib/auth";
import type { SettlementMethod } from "../payments/domain";
import { isChargeable, isOverdue, type Invoice, type InvoiceId } from "./domain";
import { resolveBearerInvoice } from "./lib/accessToken";
import { deriveInvoiceMuxedAddress } from "./lib/muxedAddress";

/** Current UTC date as a `YYYY-MM-DD` string for due-date comparison. */
function utcToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

/**
 * Derive an invoice's payment method from its succeeded settlement row.
 * `method` is no longer stored on the invoice — it lives on the settlement
 * `payments` row recorded when the invoice was paid.
 */
async function resolveInvoiceMethod(
  ctx: QueryCtx,
  invoiceId: InvoiceId,
): Promise<SettlementMethod | null> {
  const settlements = await ctx.db
    .query("payments")
    .withIndex("by_invoice", (q) => q.eq("invoiceId", invoiceId))
    .collect();
  return settlements.find((p) => p.status === "succeeded")?.method ?? null;
}

type InvoiceSummary = Pick<
  Invoice,
  | "_id"
  | "_creationTime"
  | "agencyId"
  | "publicId"
  | "periodMonth"
  | "issuedAt"
  | "dueDate"
  | "totalCents"
  | "state"
  | "lineItems"
> & { method: SettlementMethod | null };

/**
 * Projection for the agency invoice table. An allowlist rather than an
 * omission: a list read fans every row out into the RSC payload and the Convex
 * client cache, so the bearer `accessToken` — and any credential field added
 * later — has to be opted in, never opted out. The share link is built from
 * the detail read, which is the one place a single token is actually wanted.
 */
function shapeInvoiceSummary(invoice: Invoice, method: SettlementMethod | null): InvoiceSummary {
  return {
    _id: invoice._id,
    _creationTime: invoice._creationTime,
    agencyId: invoice.agencyId,
    publicId: invoice.publicId,
    periodMonth: invoice.periodMonth,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    totalCents: invoice.totalCents,
    state: invoice.state,
    lineItems: invoice.lineItems,
    method,
  };
}

export const listByAgency = queryWithAgencyScope({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("invoices")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", ctx.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);

    const page = await Promise.all(
      result.page.map(async (invoice) =>
        shapeInvoiceSummary(invoice, await resolveInvoiceMethod(ctx, invoice._id)),
      ),
    );
    return { ...result, page };
  },
});

/**
 * Resource-by-id read. Returns null on three indistinguishable cases —
 * invoice doesn't exist, caller isn't authenticated, caller isn't a member
 * of the invoice's agency — to avoid leaking cross-agency existence. Action
 * callers reading this should map null to `INVOICE_NOT_FOUND` and accept
 * the ambiguity.
 */
export const getById = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice) return null;

    try {
      await assertAgencyAccess(ctx, invoice.agencyId);
    } catch {
      return null;
    }

    return { ...invoice, method: await resolveInvoiceMethod(ctx, invoice._id) };
  },
});

/**
 * Resource-by-id read keyed on publicId. Same null-on-miss semantics as
 * `getById`. Agency-staff query — for tenant-bearer access from the public
 * portal use `getPublicByAccessToken` instead.
 */
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!invoice) return null;

    try {
      await assertAgencyAccess(ctx, invoice.agencyId);
    } catch {
      return null;
    }

    return { ...invoice, method: await resolveInvoiceMethod(ctx, invoice._id) };
  },
});

/**
 * Tenant-safe shape for the public invoice portal. No auth required — holding
 * the `accessToken` IS the authorization, so the read is gated on the token's
 * whole lifecycle (expiry, revocation, rate limit), not merely on knowing it.
 *
 * Keyed on `accessToken`, never on `publicId`: the document number embeds the
 * last four digits of the agency's CNPJ, which is public record, so gating on
 * it let anyone who knew an agency enumerate that agency's invoices for any
 * month. The token is 160 CSPRNG bits (convex/lib/randomId.ts).
 *
 * The invoice's `_id` is deliberately NOT in this shape. It used to be, because
 * the checkout actions authorized on it — which made a revoked token's holder
 * still able to start real anchor orders from an id they had already been
 * handed. Those actions now take the token, and the id has no reason to reach
 * an unauthenticated caller.
 */
export const getPublicByAccessToken = query({
  args: { accessToken: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveBearerInvoice(ctx, {
      accessToken: args.accessToken,
      nowMs: Date.now(),
    });
    if (!resolved.success) return null;
    const { invoice } = resolved.data;

    const agency = await ctx.db.get(invoice.agencyId);
    if (!agency) return null;

    const muxedAddress = invoice.muxedId ? deriveInvoiceMuxedAddress(invoice.muxedId) : null;

    return {
      agencyId: invoice.agencyId,
      publicId: invoice.publicId,
      agencyName: agency.name,
      periodMonth: invoice.periodMonth,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      state: invoice.state,
      method: await resolveInvoiceMethod(ctx, invoice._id),
      muxedAddress,
    };
  },
});

/**
 * Internal — look up an invoice by its Stellar muxed-id. O(1) via
 * `by_muxedId` index. Used by the Horizon-polling reconciler.
 */
export const findByMuxedId = internalQuery({
  args: { muxedId: v.string() },
  handler: async (ctx, { muxedId }) => {
    return ctx.db
      .query("invoices")
      .withIndex("by_muxedId", (q) => q.eq("muxedId", muxedId))
      .unique();
  },
});

/**
 * Internal — current Horizon cursor for a given treasury source account.
 * Used by the polling action to resume from the last seen page.
 */
export const getStellarIndexState = internalQuery({
  args: { sourceAccount: v.string() },
  handler: async (ctx, { sourceAccount }) => {
    return ctx.db
      .query("stellarIndexState")
      .withIndex("by_sourceAccount", (q) => q.eq("sourceAccount", sourceAccount))
      .unique();
  },
});

/**
 * Count of overdue invoices for the current agency — open invoices whose
 * `dueDate` is strictly before today (UTC). Overdue is derived now (no
 * stored state), so the reducer compares against today's date computed
 * once at handler start. Used by the Inadimplências KPI tile on the
 * dashboard until a dedicated delinquency domain ships (see issue #52).
 *
 * Scans the agency-scoped invoices index — bounded by agency size, no
 * full-table scan.
 */
export const getOverdueCount = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    const today = utcToday();
    const rows = await ctx.db
      .query("invoices")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", ctx.agencyId))
      .collect();
    return rows.reduce((count, invoice) => (isOverdue(invoice, today) ? count + 1 : count), 0);
  },
});

/**
 * Returns the next open invoice for the agency, ordered by periodMonth
 * ascending (earliest first). Open invoices are the chargeable ones
 * (overdue is a derived display of an open, past-due invoice).
 *
 * Uses the `by_agency_period` index — no full-table scan.
 */
export const getNextOpenInvoice = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    const page = await ctx.db
      .query("invoices")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", ctx.agencyId))
      .order("asc")
      .collect();

    const next = page.find((invoice) => isChargeable(invoice.state));

    if (!next) return null;
    return {
      publicId: next.publicId,
      dueDate: next.dueDate,
      totalCents: next.totalCents,
    };
  },
});
