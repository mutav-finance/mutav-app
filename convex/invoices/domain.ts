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

// ─── Bearer credential lifecycle ──────────────────────────────────────────────

export type BearerRateLimitScope = "token" | "ip";

export const BEARER_RATE_LIMIT_SCOPE = {
  TOKEN: "token",
  IP: "ip",
} as const satisfies Record<Uppercase<BearerRateLimitScope>, BearerRateLimitScope>;

export type BearerDenialReason = "MISSING" | "UNKNOWN" | "EXPIRED" | "REVOKED" | "RATE_LIMITED";

export const BEARER_DENIAL_REASON = {
  MISSING: "MISSING",
  UNKNOWN: "UNKNOWN",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED",
  RATE_LIMITED: "RATE_LIMITED",
} as const satisfies Record<BearerDenialReason, BearerDenialReason>;

const MS_PER_DAY = 86_400_000;

/**
 * How long a checkout link stays usable from the moment the invoice is issued.
 *
 * The constraint that sets the floor is the product, not the threat model: a
 * tenant must be able to pay a bill that is legitimately outstanding, and a
 * Mutav invoice can be outstanding for a long time — it falls due on the 10th,
 * then runs through the notice and delinquency process before anyone writes it
 * off. A 30- or 60-day TTL would routinely kill the link of a payer who is
 * late but paying, and every one of those is a support ticket that ends in
 * someone reissuing a credential by hand.
 *
 * Six months is the first horizon past which "still trying to collect via a
 * self-service link" stops being true: by then the contract is in the
 * delinquency book and collection is a human process, not a URL. It also
 * bounds the real exposure — a link forwarded into a group chat, pasted into a
 * support ticket or left in a mailbox dies inside one rental semester instead
 * of outliving the tenancy.
 */
export const INVOICE_ACCESS_TOKEN_TTL_MS = 180 * MS_PER_DAY;

/**
 * Once the invoice settles, the link's only remaining job is showing the payer
 * their receipt, so it stops running on the issuance clock and expires on its
 * own, much shorter one. Seven days covers "I paid, send me the confirmation"
 * without leaving a permanent, unauthenticated record of a person's rent
 * sitting behind a URL that has already done everything it was minted for.
 */
export const INVOICE_ACCESS_TOKEN_SETTLED_GRACE_MS = 7 * MS_PER_DAY;

/** Absolute expiry for a token minted at `issuedAtMs`. */
export function accessTokenExpiryFrom(issuedAtMs: number): number {
  return issuedAtMs + INVOICE_ACCESS_TOKEN_TTL_MS;
}

/**
 * Expiry after settlement. Never extends an existing deadline — settlement can
 * only bring the expiry forward, so an invoice paid on day 1 does not gain
 * another week of reachable bearer access.
 */
export function settledAccessTokenExpiry(
  currentExpiresAt: number | undefined,
  settledAtMs: number,
): number {
  const graceExpiry = settledAtMs + INVOICE_ACCESS_TOKEN_SETTLED_GRACE_MS;
  return currentExpiresAt === undefined ? graceExpiry : Math.min(currentExpiresAt, graceExpiry);
}

/**
 * The lifecycle half of bearer authorization: why this invoice's token must
 * not be honored right now, or `null` when it may be. Revocation is reported
 * ahead of expiry so an operator who revokes a link can tell from the denial
 * that the revocation is what took effect.
 */
export function bearerLifecycleDenial(
  invoice: Pick<Invoice, "accessTokenExpiresAt" | "accessTokenRevokedAt">,
  nowMs: number,
): BearerDenialReason | null {
  if (invoice.accessTokenRevokedAt !== undefined && invoice.accessTokenRevokedAt <= nowMs) {
    return BEARER_DENIAL_REASON.REVOKED;
  }
  if (invoice.accessTokenExpiresAt === undefined || invoice.accessTokenExpiresAt <= nowMs) {
    return BEARER_DENIAL_REASON.EXPIRED;
  }
  return null;
}

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
