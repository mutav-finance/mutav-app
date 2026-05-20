import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { AUDIT_ANCHOR_STATUS } from "./domain";
import type { AuditAnchorId, AuditEntry, StellarNetwork } from "./domain";
import { computeMerkleRoot } from "./merkle";

/**
 * Compute the Merkle root over every audit entry committed since the most
 * recent anchor (or since genesis if this is the first anchor). Inserts a
 * `pending` anchor row; the submit-to-Stellar action lifts it to
 * `submitted` (or `failed`) once the on-chain tx settles.
 *
 * Called from the daily cron action `submitDailyAnchor`. Also useful as a
 * runbook command — `bunx convex run audit/anchor:computeAuditAnchor`
 * computes the next anchor without submitting, handy for inspecting what
 * would land on chain before committing real funds.
 *
 * Anchors over zero entries are still meaningful: they assert "no audit
 * entries in the period", which is itself a verifiable claim and keeps
 * the daily cadence intact during quiet periods.
 */
export const computeAuditAnchor = internalMutation({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ anchorId: AuditAnchorId; rootHash: string; entryCount: number }> => {
    const now = Date.now();

    // Resume from the last anchor's periodEnd. The first ever anchor reads
    // from timestamp 0 (genesis). Picking up at periodEnd (exclusive lower
    // bound on the next anchor) means every entry is covered by exactly
    // one anchor — no gaps, no overlap.
    const lastAnchor = await ctx.db
      .query("mutavAuditAnchors")
      .withIndex("by_periodEnd")
      .order("desc")
      .first();
    const periodStart = lastAnchor?.periodEnd ?? 0;
    const periodEnd = now;

    const entries = await collectEntriesInRange(ctx, periodStart, periodEnd);
    const rootHash = await computeMerkleRoot(entries.map((e) => e.entryHash));

    const anchorId = await ctx.db.insert("mutavAuditAnchors", {
      rootHash,
      stellarTxHash: null,
      stellarNetwork: null,
      periodStart,
      periodEnd,
      entryCount: entries.length,
      anchoredAt: now,
      status: AUDIT_ANCHOR_STATUS.PENDING,
      failureReason: null,
    });

    return { anchorId, rootHash, entryCount: entries.length };
  },
});

/**
 * Promote a pending anchor to `submitted` after the Stellar tx has been
 * accepted by Horizon. Idempotent: calling twice with the same
 * `stellarTxHash` is a no-op once the row is already submitted.
 */
export const markAnchorSubmitted = internalMutation({
  args: {
    anchorId: v.id("mutavAuditAnchors"),
    stellarTxHash: v.string(),
    stellarNetwork: v.union(v.literal("testnet"), v.literal("public")),
  },
  handler: async (ctx, { anchorId, stellarTxHash, stellarNetwork }) => {
    const anchor = await ctx.db.get(anchorId);
    if (!anchor) throw new Error(`Audit anchor ${anchorId} not found`);
    if (anchor.status === AUDIT_ANCHOR_STATUS.SUBMITTED) {
      // Idempotent — the cron retried after a transient network hiccup.
      if (anchor.stellarTxHash === stellarTxHash) return { idempotent: true as const };
      throw new Error(
        `Audit anchor ${anchorId} already submitted with txHash ${anchor.stellarTxHash}; ` +
          `refusing to overwrite with ${stellarTxHash}`,
      );
    }
    await ctx.db.patch(anchorId, {
      stellarTxHash,
      stellarNetwork,
      status: AUDIT_ANCHOR_STATUS.SUBMITTED,
      failureReason: null,
    });
    return { idempotent: false as const };
  },
});

/**
 * Mark a pending anchor as failed and record why. The cron will leave
 * this row alone (audit trail of the attempt) and create a fresh anchor
 * tomorrow covering the same period — the loser's `periodStart` matches,
 * so the next-day attempt walks the same entries again.
 */
export const markAnchorFailed = internalMutation({
  args: {
    anchorId: v.id("mutavAuditAnchors"),
    stellarNetwork: v.union(v.literal("testnet"), v.literal("public")),
    failureReason: v.string(),
  },
  handler: async (ctx, { anchorId, stellarNetwork, failureReason }) => {
    const anchor = await ctx.db.get(anchorId);
    if (!anchor) throw new Error(`Audit anchor ${anchorId} not found`);
    if (anchor.status !== AUDIT_ANCHOR_STATUS.PENDING) {
      // Don't downgrade a `submitted` row, and don't double-write a `failed` one.
      return { unchanged: true as const, currentStatus: anchor.status };
    }
    await ctx.db.patch(anchorId, {
      stellarNetwork,
      status: AUDIT_ANCHOR_STATUS.FAILED,
      failureReason,
    });
    return { unchanged: false as const };
  },
});

export type VerifyLatestAnchorResult =
  | {
      valid: true;
      anchorId: AuditAnchorId;
      rootHash: string;
      entriesChecked: number;
      stellarTxHash: string | null;
      stellarNetwork: StellarNetwork | null;
    }
  | { valid: false; reason: "no_anchor" }
  | {
      valid: false;
      reason: "root_mismatch";
      anchorId: AuditAnchorId;
      expectedRoot: string;
      computedRoot: string;
      entriesChecked: number;
    };

/**
 * Recompute the Merkle root for the most recent anchor's period and
 * compare against the stored `rootHash`. Mismatch = something between
 * the anchor row and the audit log changed after the anchor was written;
 * the Stellar tx (if submitted) is the external witness of what the root
 * was supposed to be.
 *
 * This is the daily integrity check Mutav-internal staff run before any
 * sensitive operation. The `(admin)` shell will surface it as a button;
 * for now it's an internal query callable via `bunx convex run`.
 *
 * Verifies all anchors, not just `submitted` ones — a `pending` row in
 * dev mode is still a real audit anchor, just without external witness.
 */
export const verifyLatestAnchor = internalQuery({
  args: {},
  handler: async (ctx): Promise<VerifyLatestAnchorResult> => {
    const anchor = await ctx.db
      .query("mutavAuditAnchors")
      .withIndex("by_periodEnd")
      .order("desc")
      .first();
    if (!anchor) return { valid: false, reason: "no_anchor" };

    const entries = await collectEntriesInRange(ctx, anchor.periodStart, anchor.periodEnd);
    const computedRoot = await computeMerkleRoot(entries.map((e) => e.entryHash));

    if (computedRoot !== anchor.rootHash) {
      return {
        valid: false,
        reason: "root_mismatch",
        anchorId: anchor._id,
        expectedRoot: anchor.rootHash,
        computedRoot,
        entriesChecked: entries.length,
      };
    }

    return {
      valid: true,
      anchorId: anchor._id,
      rootHash: anchor.rootHash,
      entriesChecked: entries.length,
      stellarTxHash: anchor.stellarTxHash,
      stellarNetwork: anchor.stellarNetwork,
    };
  },
});

/**
 * Read the most-recent pending anchor (the row the submit action picks
 * up after `computeAuditAnchor`). Internal to the cron flow.
 */
export const getPendingAnchor = internalQuery({
  args: { anchorId: v.id("mutavAuditAnchors") },
  handler: async (ctx, { anchorId }) => {
    return ctx.db.get(anchorId);
  },
});

/**
 * Walk `mutavAuditLog` by `by_timestamp` for entries in `[start, end)`.
 * Used by both the anchor mutation (compute root over a period) and the
 * verification query (recompute the same root). Both must scan the same
 * way for the Merkle leaves to line up byte-for-byte.
 */
async function collectEntriesInRange(
  ctx: QueryCtx,
  start: number,
  end: number,
): Promise<AuditEntry[]> {
  return ctx.db
    .query("mutavAuditLog")
    .withIndex("by_timestamp", (q) => q.gte("timestamp", start).lt("timestamp", end))
    .order("asc")
    .collect();
}
