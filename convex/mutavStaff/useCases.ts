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
import type { Result } from "../lib/result";
import type { MutavStaff, MutavStaffId, MutavStaffRole } from "./domain";
import {
  MUTAV_STAFF_ERROR_CODE,
  MUTAV_STAFF_ROLE,
  mutavStaffRoleValidator,
  readMutavRolesClaim,
} from "./domain";

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

// ─── Staff-role provisioning (admin panel /staff page) ──────────────────────
//
// `createStaffRole` and `deleteStaffRole` are the deliberate, admin-driven
// alternative to `syncFromIdentity`. Both are admin-gated, both write a
// hash-chained audit entry, and both operate on (auth0Sub, role) pairs so the
// admin panel doesn't need to know Convex user ids.

type StaffRow = {
  staffId: MutavStaffId;
  userId: MutavStaff["userId"];
  auth0Sub: string;
  role: MutavStaffRole;
  createdAt: string;
  addedBy: MutavStaff["addedBy"] | null;
  addedByName: string | null;
};

type CreateStaffRoleSuccess = { staffId: MutavStaffId };
type CreateStaffRoleError = {
  code:
    | typeof MUTAV_STAFF_ERROR_CODE.ROLE_ALREADY_EXISTS
    | typeof MUTAV_STAFF_ERROR_CODE.USER_NOT_FOUND;
};

type DeleteStaffRoleSuccess = { deleted: true };
type DeleteStaffRoleError = {
  code:
    | typeof MUTAV_STAFF_ERROR_CODE.ROLE_NOT_FOUND
    | typeof MUTAV_STAFF_ERROR_CODE.SELF_REVOKE_LAST_ADMIN;
};

/** All staff rows across every user, enriched with auth0Sub + addedBy display name. Admin only. */
export const listAllStaff = queryWithMutavRole({ minRole: "admin" })({
  args: {},
  handler: async (ctx): Promise<StaffRow[]> => {
    const rows = await ctx.db.query("mutavStaff").collect();
    const userIds = new Set(rows.map((row) => row.userId));
    for (const row of rows) {
      if (row.addedBy) userIds.add(row.addedBy);
    }
    const userById = new Map<string, { subject: string | undefined; name: string }>();
    for (const userId of userIds) {
      const user = await ctx.db.get(userId);
      if (user) userById.set(userId, { subject: user.subject, name: user.name });
    }
    return rows.map((row) => {
      const user = userById.get(row.userId);
      const addedByUser = row.addedBy ? userById.get(row.addedBy) : undefined;
      return {
        staffId: row._id,
        userId: row.userId,
        auth0Sub: user?.subject ?? "",
        role: row.role,
        createdAt: row.createdAt,
        addedBy: row.addedBy ?? null,
        addedByName: addedByUser?.name ?? null,
      };
    });
  },
});

/** All staff rows for one Auth0 subject. Admin only. */
export const listStaffByAuth0Sub = queryWithMutavRole({ minRole: "admin" })({
  args: { auth0Sub: v.string() },
  handler: async (ctx, { auth0Sub }): Promise<{ role: MutavStaffRole; createdAt: string }[]> => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", auth0Sub))
      .unique();
    if (!user) return [];
    const rows = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows.map((row) => ({ role: row.role, createdAt: row.createdAt }));
  },
});

/**
 * Grant a (auth0Sub, role) row. Idempotent per role — a second call with the
 * same pair returns `ROLE_ALREADY_EXISTS` rather than inserting a duplicate.
 * The target user must have logged in at least once (a `users` row for that
 * subject must exist); we do not create user rows here to avoid a spoofing
 * vector where an admin invents an auth0Sub and pre-provisions permissions
 * for it before the real identity ever signs in.
 */
export const createStaffRole = mutationWithMutavRole({ minRole: "admin" })({
  args: { auth0Sub: v.string(), role: mutavStaffRoleValidator },
  handler: async (
    ctx,
    { auth0Sub, role },
  ): Promise<Result<CreateStaffRoleSuccess, CreateStaffRoleError>> => {
    const target = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", auth0Sub))
      .unique();
    if (!target) {
      return {
        success: false,
        error: { code: MUTAV_STAFF_ERROR_CODE.USER_NOT_FOUND },
        message: "No user with that Auth0 subject exists yet.",
      };
    }

    const existing = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user_role", (q) => q.eq("userId", target._id).eq("role", role))
      .unique();
    if (existing) {
      return {
        success: false,
        error: { code: MUTAV_STAFF_ERROR_CODE.ROLE_ALREADY_EXISTS },
        message: "Target already holds this role.",
      };
    }

    const staffId = await ctx.db.insert("mutavStaff", {
      userId: target._id,
      role,
      createdAt: new Date().toISOString(),
      addedBy: ctx.user._id,
    });

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.STAFF_CREATED,
      resourceType: "mutavStaff",
      resourceId: staffId,
      payload: { targetUserId: target._id, auth0Sub, role },
    });

    return {
      success: true,
      data: { staffId },
      message: "Staff role granted.",
    };
  },
});

/**
 * Revoke a (auth0Sub, role) row. Refuses to remove the caller's own last
 * `admin` role when nobody else holds `admin` — otherwise the panel would
 * become unreachable and the only recovery would be a direct-database write.
 */
export const deleteStaffRole = mutationWithMutavRole({ minRole: "admin" })({
  args: { auth0Sub: v.string(), role: mutavStaffRoleValidator },
  handler: async (
    ctx,
    { auth0Sub, role },
  ): Promise<Result<DeleteStaffRoleSuccess, DeleteStaffRoleError>> => {
    const target = await ctx.db
      .query("users")
      .withIndex("by_subject", (q) => q.eq("subject", auth0Sub))
      .unique();
    if (!target) {
      return {
        success: false,
        error: { code: MUTAV_STAFF_ERROR_CODE.ROLE_NOT_FOUND },
        message: "No staff row for that Auth0 subject and role.",
      };
    }

    const existing = await ctx.db
      .query("mutavStaff")
      .withIndex("by_user_role", (q) => q.eq("userId", target._id).eq("role", role))
      .unique();
    if (!existing) {
      return {
        success: false,
        error: { code: MUTAV_STAFF_ERROR_CODE.ROLE_NOT_FOUND },
        message: "No staff row for that Auth0 subject and role.",
      };
    }

    if (target._id === ctx.user._id && role === MUTAV_STAFF_ROLE.ADMIN) {
      const admins = await ctx.db
        .query("mutavStaff")
        .withIndex("by_role", (q) => q.eq("role", MUTAV_STAFF_ROLE.ADMIN))
        .collect();
      const remaining = admins.filter((row) => row._id !== existing._id);
      if (remaining.length === 0) {
        return {
          success: false,
          error: { code: MUTAV_STAFF_ERROR_CODE.SELF_REVOKE_LAST_ADMIN },
          message: "Cannot revoke your own last admin role — no other admin remains.",
        };
      }
    }

    await ctx.db.delete(existing._id);

    await ctx.appendStaffAudit({
      action: AUDIT_ACTION.STAFF_DELETED,
      resourceType: "mutavStaff",
      resourceId: existing._id,
      payload: { targetUserId: target._id, auth0Sub, role },
    });

    return {
      success: true,
      data: { deleted: true },
      message: "Staff role revoked.",
    };
  },
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
