import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalQuery, query } from "../_generated/server";
import { assertAgencyAccess, queryWithAgencyScope } from "../lib/auth";
import { isChargeable, isOverdue } from "./domain";
import { deriveInvoiceMuxedAddress } from "./lib/muxedAddress";

/** Current UTC date as a `YYYY-MM-DD` string for due-date comparison. */
function utcToday(): string {
  return new Date().toISOString().split("T")[0]!;
}

export const listByAgency = queryWithAgencyScope({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    return ctx.db
      .query("invoices")
      .withIndex("by_agency_period", (q) => q.eq("agencyId", ctx.agencyId))
      .order("desc")
      .paginate(args.paginationOpts);
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

    return invoice;
  },
});

/**
 * Resource-by-id read keyed on publicId. Same null-on-miss semantics as
 * `getById`. Agency-staff query — for tenant-bearer access from the public
 * portal use `getPublicByPublicId` instead.
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

    return invoice;
  },
});

/**
 * Tenant-safe shape for the public invoice portal. No auth required — the
 * high-entropy `publicId` IS the bearer. Carries everything the tenant
 * checkout flow needs (including `invoiceId` and `agencyId`, which the
 * checkout actions consume) plus the derived Stellar `M…` destination
 * address. Excludes only system fields the tenant has no use for.
 */
export const getPublicByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!invoice) return null;

    const agency = await ctx.db.get(invoice.agencyId);
    if (!agency) return null;

    const muxedAddress = invoice.muxedId ? deriveInvoiceMuxedAddress(invoice.muxedId) : null;

    return {
      invoiceId: invoice._id,
      agencyId: invoice.agencyId,
      publicId: invoice.publicId,
      agencyName: agency.name,
      periodMonth: invoice.periodMonth,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
      state: invoice.state,
      method: invoice.method,
      muxedAddress,
    };
  },
});

/**
 * Internal companion to `getById` for actions that authorize by the
 * publicId-bearer model (tenant checkout) rather than by user identity.
 * The tenant has no session, so the identity-gated `getById` would always
 * return null post-Auth0. The action gates on chargeability instead.
 */
export const getByIdInternal = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    return ctx.db.get(invoiceId);
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
