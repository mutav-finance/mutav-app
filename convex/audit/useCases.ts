import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { AppendAuditEntryInput, AuditEntry, AuditEntryId } from "./domain";
import { GENESIS_PREV_HASH } from "./domain";

/**
 * Hex SHA-256 of a UTF-8 string via WebCrypto. V8-compatible. Same primitive
 * shape as `hashPii` in `convex/lib/pii.ts`, but unpeppered — the audit log
 * doesn't need keyspace protection because what it hashes is high-entropy
 * (timestamps, IDs, payloads), and the integrity property we want is "any
 * change to the input flips the output" rather than "input not enumerable".
 */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  let hex = "";
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Deterministic JSON canonicalization: object keys sorted, no insignificant
 * whitespace, recursive. Two structurally equal payloads always produce the
 * same string, so two `payloadHash` values are equal iff the inputs are.
 * V8's `JSON.stringify` preserves insertion order, which is fine for fresh
 * objects but not when comparing payloads constructed in different orders;
 * sorting keys removes that ambiguity.
 *
 * Skips `undefined` values (matches `JSON.stringify` behavior). Convex Id
 * values are strings at runtime so they pass through `JSON.stringify`.
 */
function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return "{" + entries.map(([k, v]) => JSON.stringify(k) + ":" + canonicalize(v)).join(",") + "}";
  }
  return "null";
}

/**
 * Compute the entryHash for an audit row from its canonicalized contents.
 * Pure function — exported for the verification path and the tests, since
 * both need to recompute hashes from existing rows.
 */
export async function computeEntryHash(args: {
  timestamp: number;
  actor: AuditEntry["actor"];
  action: string;
  resourceType: string;
  resourceId: string;
  payloadHash: string;
  prevHash: string;
}): Promise<string> {
  return sha256(canonicalize(args));
}

/**
 * Append a new entry to the global hash-chained audit log. Reads the most
 * recent entry to chain on, computes the payload + entry hashes, inserts.
 *
 * Concurrency: two parallel mutations both call this, both read the same
 * "latest" entry, both compute the same prevHash, both insert. Convex
 * single-doc OCC detects the read-set conflict on the `by_timestamp` range
 * and retries the loser; on retry the loser observes the now-newer latest
 * and computes a fresh prevHash. The chain stays linear and tamper-evident.
 *
 * Must be called from a `mutation` / `internalMutation` / `mutationWith*`
 * handler — never from an action (action ctx has no transactional DB).
 * The audit insert and the calling mutation's writes commit atomically:
 * if the calling mutation throws after `appendAuditEntry`, the audit row
 * rolls back with the rest of the transaction (no "orphan" audit entry).
 */
export async function appendAuditEntry(
  ctx: MutationCtx,
  input: AppendAuditEntryInput,
): Promise<AuditEntryId> {
  const timestamp = Date.now();

  const latest = await ctx.db
    .query("mutavAuditLog")
    .withIndex("by_timestamp")
    .order("desc")
    .first();
  const prevHash = latest?.entryHash ?? GENESIS_PREV_HASH;

  const payloadHash = await sha256(canonicalize(input.payload));
  const entryHash = await computeEntryHash({
    timestamp,
    actor: input.actor,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payloadHash,
    prevHash,
  });

  return ctx.db.insert("mutavAuditLog", {
    actor: input.actor,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    payloadHash,
    prevHash,
    entryHash,
    timestamp,
  });
}

export type VerifyChainResult =
  | { valid: true; entriesChecked: number }
  | { valid: false; brokenAtId: AuditEntryId; reason: "prevHashMismatch" | "entryHashMismatch" };

/**
 * Walk the entire audit log in chronological order and verify two
 * invariants on every entry:
 *
 * 1. `prevHash` equals the previous entry's `entryHash` (chain link)
 * 2. `entryHash` equals the SHA-256 of the canonicalized entry (integrity)
 *
 * O(n) scan over the full table. For v1 the table is small enough that
 * this can be called on demand; once volume grows, the daily Merkle anchor
 * (P1b) becomes the cheap-to-verify path and this becomes the deep-audit
 * tool used during incident response.
 */
export async function verifyChain(ctx: QueryCtx): Promise<VerifyChainResult> {
  const entries = await ctx.db
    .query("mutavAuditLog")
    .withIndex("by_timestamp")
    .order("asc")
    .collect();

  let expectedPrev = GENESIS_PREV_HASH;
  for (const entry of entries) {
    if (entry.prevHash !== expectedPrev) {
      return { valid: false, brokenAtId: entry._id, reason: "prevHashMismatch" };
    }
    const recomputed = await computeEntryHash({
      timestamp: entry.timestamp,
      actor: entry.actor,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      payloadHash: entry.payloadHash,
      prevHash: entry.prevHash,
    });
    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAtId: entry._id, reason: "entryHashMismatch" };
    }
    expectedPrev = entry.entryHash;
  }
  return { valid: true, entriesChecked: entries.length };
}

/**
 * Forensic query — chronological audit trail for a (resourceType, resourceId).
 * Internal-only for now; an `(admin)` wrapper will expose it once that
 * shell ships. Uses the `by_resource` composite index to avoid a full scan.
 */
export const auditLogByResource = internalQuery({
  args: {
    resourceType: v.string(),
    resourceId: v.string(),
  },
  handler: async (ctx, { resourceType, resourceId }) => {
    return ctx.db
      .query("mutavAuditLog")
      .withIndex("by_resource", (q) =>
        q.eq("resourceType", resourceType).eq("resourceId", resourceId),
      )
      .order("asc")
      .collect();
  },
});

/**
 * Internal-only chain verification wrapper. Lets a future admin handler
 * (or a CI integrity check) run verifyChain via a normal Convex query.
 */
export const verifyChainQuery = internalQuery({
  args: {},
  handler: async (ctx): Promise<VerifyChainResult> => verifyChain(ctx),
});
