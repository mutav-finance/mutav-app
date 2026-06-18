import { v } from "convex/values";
import {
  mutationWithAuth,
  mutationWithMutavRole,
  queryWithAuth,
  queryWithMutavRole,
} from "../lib/auth";
import { AUDIT_ACTION } from "../audit/domain";
import { agencyDocumentKindValidator } from "../agencies/domain";
import {
  applyOnboardingReview,
  collectPendingReviews,
  resolveDocumentDownloadUrl,
} from "../agencies/adminUseCases";
import type { MutavStaffRole } from "./domain";
import { readMutavRolesClaim } from "./domain";

// ─── Mutav staff — identity + provisioning ───────────────────────────────────
//
// These three are deliberately NOT aud-bound: they are cross-app routing reads
// (`amIStaff`/`getMyStaff` drive the agency→admin redirect + the shell-switcher)
// and the first-login provisioning bridge. They report or grant membership;
// they never EXERCISE a staff capability. Every actual staff power goes through
// the aud-bound `*WithMutavStaff` / `*WithMutavRole` wrappers in
// convex/lib/auth.ts. Identity is keyed on `subject`, so these resolve the same
// human whether the token came from the agency or the admin app.

/** The caller's staff roles, or `null` when they hold none. Used by the admin gate + shell. */
export const getMyStaff = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<{ roles: MutavStaffRole[] } | null> => {
    const rows = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();
    if (rows.length === 0) return null;
    return { roles: rows.map((row) => row.role) };
  },
});

/** Lightweight boolean for routing (agency staff branch + shell-switcher visibility). */
export const amIStaff = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .first();
    return row !== null;
  },
});

/**
 * Provisioning bridge — called from the admin app's Auth0 `onCallback` after
 * the user row exists (via `users.getOrCreateByIdentity`). Reads the namespaced
 * roles claim the admin Post-Login Action injects and grants any missing
 * `mutavStaff` rows.
 *
 * ADDITIVE ONLY (v1): grants roles in the claim, never revokes. This makes the
 * call safe from any context — a token without the claim (e.g. an accidental
 * agency-app call) is a no-op rather than wiping someone's staff access.
 * Revocation is a deliberate follow-up (admin action / explicit re-sync), not a
 * side effect of login.
 */
export const syncFromIdentity = mutationWithAuth({
  args: {},
  handler: async (ctx): Promise<{ granted: MutavStaffRole[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { granted: [] };

    const claimedRoles = readMutavRolesClaim(identity);
    if (claimedRoles.length === 0) return { granted: [] };

    const existing = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();
    const existingRoles = new Set(existing.map((row) => row.role));

    const now = new Date().toISOString();
    const granted: MutavStaffRole[] = [];
    for (const role of claimedRoles) {
      if (!existingRoles.has(role)) {
        await ctx.db.insert("mutavStaff", { userId: ctx.user._id, role, createdAt: now });
        granted.push(role);
      }
    }
    return { granted };
  },
});

// ─── Staff-gated admin operations (the onboarding review surface) ────────────
//
// PUBLIC entry points, each aud-bound + role-gated via the wrappers. They reuse
// the agency-domain helpers in convex/agencies/adminUseCases.ts; the gate lives
// here, the logic stays in the agency domain.

/** KYC/KYB review queue. Compliance and above. */
export const listPendingReviews = queryWithMutavRole({ minRole: "compliance" })({
  args: {},
  handler: async (ctx) => collectPendingReviews(ctx),
});

/** Resource-aware document download URL for a (agency, kind) under review. Compliance and above. */
export const getDocumentDownloadUrl = queryWithMutavRole({ minRole: "compliance" })({
  args: { agencyId: v.id("agencies"), kind: agencyDocumentKindValidator },
  handler: async (ctx, { agencyId, kind }) => resolveDocumentDownloadUrl(ctx, { agencyId, kind }),
});

/** Approve/reject an onboarding submission. Admin only; writes a hash-chained audit entry. */
export const reviewOnboarding = mutationWithMutavRole({ minRole: "admin" })({
  args: {
    agencyId: v.id("agencies"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await applyOnboardingReview(ctx, args);
    if (result.success) {
      await ctx.appendStaffAudit({
        action: AUDIT_ACTION.ONBOARDING_REVIEWED,
        resourceType: "agency",
        resourceId: args.agencyId,
        payload: { decision: args.decision, rejectionReason: args.rejectionReason ?? null },
      });
    }
    return result;
  },
});
