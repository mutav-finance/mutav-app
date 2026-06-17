import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { SettlementMethod } from "../payments/domain";

export type Invoice = Doc<"invoices">;
export type InvoiceId = Id<"invoices">;

/**
 * An invoice enriched with its settlement `method`, resolved at read time
 * from the succeeded `payments` row. `method` is no longer stored on the
 * invoice itself, so reads that need it (detail/list shapes) return this.
 */
export type ResolvedInvoice = Invoice & { method: SettlementMethod | null };
export type InvoiceLineItem = Invoice["lineItems"][number];
export type InvoiceLineItemKind = InvoiceLineItem["kind"];

/** Discriminated union — the lifecycle state of an invoice. */
export type InvoiceState = Invoice["state"];
export type InvoiceStateKind = InvoiceState["kind"];

/**
 * Display status for an invoice — the stored state kinds plus the derived
 * `overdue` (an `open` invoice past its `dueDate`). Not a stored value;
 * computed at read time via {@link derivedStatus}.
 */
export type InvoiceDisplayStatus = "open" | "overdue" | "paid" | "void";

// ─── State constants ──────────────────────────────────────────────────────────

export const INVOICE_STATE_KIND = {
  OPEN: "open",
  PAID: "paid",
  VOID: "void",
} as const satisfies Record<Uppercase<InvoiceStateKind>, InvoiceStateKind>;

// ─── Line item constants ──────────────────────────────────────────────────────

export const INVOICE_LINE_ITEM_KIND = {
  RECURRING: "recurring",
  ACTIVATION: "activation",
} as const satisfies Record<Uppercase<InvoiceLineItemKind>, InvoiceLineItemKind>;

// ─── Validators (for use in Convex function args) ─────────────────────────────

export const invoiceStateKindValidator = v.union(
  v.literal(INVOICE_STATE_KIND.OPEN),
  v.literal(INVOICE_STATE_KIND.PAID),
  v.literal(INVOICE_STATE_KIND.VOID),
);

export const invoiceLineItemKindValidator = v.union(
  v.literal(INVOICE_LINE_ITEM_KIND.RECURRING),
  v.literal(INVOICE_LINE_ITEM_KIND.ACTIVATION),
);

// ─── State constructors (type-safe helpers) ───────────────────────────────────

// `void` is a reserved word, so the constructor for the `void` state is `voided`.
export const InvoiceStates = {
  open: (): Extract<InvoiceState, { kind: "open" }> => ({ kind: "open" }),
  paid: (paidAt: string): Extract<InvoiceState, { kind: "paid" }> => ({ kind: "paid", paidAt }),
  voided: (): Extract<InvoiceState, { kind: "void" }> => ({ kind: "void" }),
} as const;

// ─── Predicates ───────────────────────────────────────────────────────────────

/** An invoice is chargeable while it is open (awaiting or past its due date). */
export function isChargeable(state: InvoiceState): boolean {
  return state.kind === INVOICE_STATE_KIND.OPEN;
}

/**
 * True when an open invoice's due date has already passed. `today` is a UTC
 * `YYYY-MM-DD` string so string comparison is a valid date comparison.
 */
export function isOverdue(invoice: Pick<Invoice, "state" | "dueDate">, today: string): boolean {
  return invoice.state.kind === INVOICE_STATE_KIND.OPEN && invoice.dueDate < today;
}

/**
 * Display status for an invoice: the stored state kind, except an open
 * invoice past its due date renders as `overdue`. `today` is a UTC
 * `YYYY-MM-DD` string.
 */
export function derivedStatus(
  invoice: Pick<Invoice, "state" | "dueDate">,
  today: string,
): InvoiceDisplayStatus {
  if (invoice.state.kind === INVOICE_STATE_KIND.OPEN) {
    return invoice.dueDate < today ? "overdue" : "open";
  }
  return invoice.state.kind;
}
