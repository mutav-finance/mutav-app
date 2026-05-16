import { v } from "convex/values";

import { internalMutation, internalQuery, query } from "../_generated/server";
import { anchorProviderValidator } from "./domain";
import {
  ANCHOR_ONBOARDING_STATUS,
  anchorAccountDataValidator,
  anchorOnboardingStatusValidator,
  type AnchorAccount,
  type AnchorAccountId,
} from "./accountDomain";

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * All anchor accounts for an agency. Public so admin UIs can render the
 * full onboarding matrix; tenant-facing surfaces shouldn't need this.
 */
export const listByAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args): Promise<AnchorAccount[]> => {
    return ctx.db
      .query("anchorAccounts")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .collect();
  },
});

/**
 * Lookup an agency's record for a specific provider, if any.
 * Returns null when the agency hasn't started onboarding with that provider.
 */
export const getByAgencyAndProvider = internalQuery({
  args: {
    agencyId: v.id("agencies"),
    provider: anchorProviderValidator,
  },
  handler: async (ctx, args): Promise<AnchorAccount | null> => {
    return ctx.db
      .query("anchorAccounts")
      .withIndex("by_agency_provider", (q) =>
        q.eq("agencyId", args.agencyId).eq("provider", args.provider),
      )
      .unique();
  },
});

/**
 * Reverse lookup for webhook reconciliation: given a provider's external
 * ID (Etherfuse orgId, Bitso accountId, etc.), find the agency that owns it.
 * O(1) via the `by_provider_externalId` index.
 */
export const getByProviderExternalId = internalQuery({
  args: {
    provider: anchorProviderValidator,
    externalId: v.string(),
  },
  handler: async (ctx, args): Promise<AnchorAccount | null> => {
    return ctx.db
      .query("anchorAccounts")
      .withIndex("by_provider_externalId", (q) =>
        q.eq("provider", args.provider).eq("externalId", args.externalId),
      )
      .unique();
  },
});

// ─── Internal mutations ───────────────────────────────────────────────────────

export const insertAccount = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    provider: anchorProviderValidator,
    status: anchorOnboardingStatusValidator,
    externalId: v.union(v.string(), v.null()),
    data: anchorAccountDataValidator,
  },
  returns: v.id("anchorAccounts"),
  handler: async (ctx, args): Promise<AnchorAccountId> => {
    const now = new Date().toISOString();
    return ctx.db.insert("anchorAccounts", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    accountId: v.id("anchorAccounts"),
    status: anchorOnboardingStatusValidator,
    externalId: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { accountId, ...patch }) => {
    await ctx.db.patch(accountId, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },
});

// ─── Predicates re-export ─────────────────────────────────────────────────────

export { ANCHOR_ONBOARDING_STATUS };
