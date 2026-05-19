import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type AuditEntry = Doc<"mutavAuditLog">;
export type AuditEntryId = Id<"mutavAuditLog">;
export type AuditAction = AuditEntry["action"];
export type AuditActor = AuditEntry["actor"];

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
  // payments/
  PAYMENT_BATCH_GENERATED: "payment.batch_generated",
  PAYMENT_MARKED_OVERDUE: "payment.marked_overdue",
  PAYMENT_METHOD_SET: "payment.method_set",
  PAYMENT_PAID: "payment.paid",
  PAYMENT_RESET: "payment.reset",
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
);

/**
 * Two-variant actor discriminator:
 * - `user` — human-initiated, ctx.user._id from an auth wrapper
 * - `system` — webhook/cron/scheduled-action initiated. `source` names the
 *   triggering subsystem (`anchor_webhook`, `cron_overdue_sweep`, …) for
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
