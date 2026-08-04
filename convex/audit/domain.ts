import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type AuditEntry = Doc<"mutavAuditLog">;
export type AuditEntryId = Id<"mutavAuditLog">;
export type AuditAction = AuditEntry["action"];
export type AuditActor = AuditEntry["actor"];

export type AuditAnchor = Doc<"mutavAuditAnchors">;
export type AuditAnchorId = Id<"mutavAuditAnchors">;
export type AuditAnchorStatus = AuditAnchor["status"];
export type StellarNetwork = NonNullable<AuditAnchor["stellarNetwork"]>;

export const AUDIT_ANCHOR_STATUS = {
  PENDING: "pending",
  SUBMITTED: "submitted",
  FAILED: "failed",
} as const satisfies Record<Uppercase<AuditAnchorStatus>, AuditAnchorStatus>;

/**
 * Sentinel `prevHash` for the very first entry in the chain. Distinct from
 * any real SHA-256 hex string because it's all zeros — a real digest has
 * uniform 0..f distribution and "all zeros" is astronomically unlikely.
 */
export const GENESIS_PREV_HASH = "0".repeat(64);

/**
 * Audit action namespaces are `<domain>.<event>` strings. Listed here so
 * grep against a single file shows every action emitted by the system; new
 * domains add their event names here when they wire `appendAuditEntry`.
 *
 * The action is part of the hashed payload, so renaming an existing key
 * breaks chain verification for historical entries — never rename, only
 * deprecate by adding a new key.
 */
export const AUDIT_ACTION = {
  // contracts/
  CONTRACT_CREATED: "contract.created",
  CONTRACT_CANCELED: "contract.canceled",
  CONTRACT_STATUS_UPDATED: "contract.status_updated",
  // payments/ (frozen wire values — historical rows only; never emitted by
  // current code, kept so the hash chain still verifies pre-rename entries).
  PAYMENT_BATCH_GENERATED: "payment.batch_generated",
  PAYMENT_MARKED_OVERDUE: "payment.marked_overdue",
  PAYMENT_METHOD_SET: "payment.method_set",
  PAYMENT_PAID: "payment.paid",
  PAYMENT_RESET: "payment.reset",
  // invoices/ (current — emitted by convex/invoices/mutations.ts).
  INVOICE_BATCH_GENERATED: "invoice.batch_generated",
  INVOICE_METHOD_SET: "invoice.method_set",
  INVOICE_PAID: "invoice.paid",
  INVOICE_RESET: "invoice.reset",
  INVOICE_ACCESS_REVOKED: "invoice.access_revoked",
  INVOICE_ACCESS_ROTATED: "invoice.access_rotated",
  // mutavStaff/ (admin onboarding review — emitted by convex/mutavStaff/useCases.ts).
  ONBOARDING_REVIEWED: "onboarding.reviewed",
  // mutavStaff/ (admin staff-role provisioning — emitted by convex/mutavStaff/useCases.ts).
  STAFF_CREATED: "staff.created",
  STAFF_DELETED: "staff.deleted",
  STAFF_BOOTSTRAP: "staff.bootstrap",
  // tenants/ (registry re-encounter with conflicting identity fields —
  // emitted by convex/tenants/useCases.ts for staff review; the registry
  // value is NOT overwritten).
  TENANT_DATA_CONFLICT: "tenant.data_conflict",
  // delinquencies/ (staff-only terminal dispositions — emitted by
  // convex/delinquencies/mutations.ts). Agency-side transitions are NOT
  // audited for the pilot; see the mutations file for the TODO.
  DELINQUENCY_RESOLVED_BY_COVER: "delinquency.resolved_by_cover",
  DELINQUENCY_DISMISSED: "delinquency.dismissed",
  DELINQUENCY_DISPUTED: "delinquency.disputed",
} as const satisfies Record<string, string>;

export type AuditActionKey = (typeof AUDIT_ACTION)[keyof typeof AUDIT_ACTION];

export const auditActionValidator = v.union(
  v.literal(AUDIT_ACTION.CONTRACT_CREATED),
  v.literal(AUDIT_ACTION.CONTRACT_CANCELED),
  v.literal(AUDIT_ACTION.CONTRACT_STATUS_UPDATED),
  v.literal(AUDIT_ACTION.PAYMENT_BATCH_GENERATED),
  v.literal(AUDIT_ACTION.PAYMENT_MARKED_OVERDUE),
  v.literal(AUDIT_ACTION.PAYMENT_METHOD_SET),
  v.literal(AUDIT_ACTION.PAYMENT_PAID),
  v.literal(AUDIT_ACTION.PAYMENT_RESET),
  v.literal(AUDIT_ACTION.INVOICE_BATCH_GENERATED),
  v.literal(AUDIT_ACTION.INVOICE_METHOD_SET),
  v.literal(AUDIT_ACTION.INVOICE_PAID),
  v.literal(AUDIT_ACTION.INVOICE_RESET),
  v.literal(AUDIT_ACTION.INVOICE_ACCESS_REVOKED),
  v.literal(AUDIT_ACTION.INVOICE_ACCESS_ROTATED),
  v.literal(AUDIT_ACTION.ONBOARDING_REVIEWED),
  v.literal(AUDIT_ACTION.STAFF_CREATED),
  v.literal(AUDIT_ACTION.STAFF_DELETED),
  v.literal(AUDIT_ACTION.STAFF_BOOTSTRAP),
  v.literal(AUDIT_ACTION.TENANT_DATA_CONFLICT),
  v.literal(AUDIT_ACTION.DELINQUENCY_RESOLVED_BY_COVER),
  v.literal(AUDIT_ACTION.DELINQUENCY_DISMISSED),
  v.literal(AUDIT_ACTION.DELINQUENCY_DISPUTED),
);

/**
 * Two-variant actor discriminator:
 * - `user` — human-initiated, ctx.user._id from an auth wrapper
 * - `system` — webhook/cron/scheduled-action initiated. `source` names the
 *   triggering subsystem (`anchor_webhook`, `cron_monthly_billing`, …) for
 *   forensic readability when reviewing the log.
 */
export const auditActorValidator = v.union(
  v.object({
    kind: v.literal("user"),
    userId: v.id("users"),
  }),
  v.object({
    kind: v.literal("system"),
    source: v.string(),
  }),
);

/**
 * Inputs to `appendAuditEntry`. The helper hashes `payload` (via canonical
 * JSON stringify), reads the previous entry's `entryHash`, and chains.
 */
export type AppendAuditEntryInput = {
  actor: AuditActor;
  action: AuditActionKey;
  resourceType: string;
  resourceId: string;
  payload: unknown;
};
