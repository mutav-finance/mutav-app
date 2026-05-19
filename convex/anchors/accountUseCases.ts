import { v } from "convex/values";

import { internalMutation, internalQuery } from "../_generated/server";
import { queryWithAgencyScope } from "../lib/auth";
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
 * All anchor accounts for the caller's agency. Scoped via wrapper —
 * caller must be a member. Tenant-facing surfaces shouldn't need this.
 */
export const listByAgency = queryWithAgencyScope({
  args: {},
  handler: async (ctx): Promise<AnchorAccount[]> => {
    return ctx.db
      .query("anchorAccounts")
      .withIndex("by_agency", (q) => q.eq("agencyId", ctx.agencyId))
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

/**
 * Record the Stellar tx hash that provisioned an etherfuse proxy
 * account. Called immediately after `submitTransaction` resolves —
 * presence of this field is the marker that the on-chain create
 * account + trustline are real, so subsequent provisioning calls
 * short-circuit instead of double-spending reserves.
 */
export const markEtherfuseProvisioningHash = internalMutation({
  args: {
    accountId: v.id("anchorAccounts"),
    provisioningTxHash: v.string(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error(`anchorAccounts ${args.accountId} not found`);
    if (account.data.provider !== "etherfuse") {
      throw new Error(
        `anchorAccounts ${args.accountId} is not an etherfuse account (data.provider=${account.data.provider})`,
      );
    }
    await ctx.db.patch(args.accountId, {
      data: { ...account.data, provisioningTxHash: args.provisioningTxHash },
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Atomically flip the onboarding status to `approved` AND the etherfuse
 * kycStatus to `approved`. Onboarding previously did these as two
 * sequential runMutation calls; if the second one threw, the row was
 * left half-approved and the next run had no resume path.
 */
export const markEtherfuseOnboardingApproved = internalMutation({
  args: { accountId: v.id("anchorAccounts") },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error(`anchorAccounts ${args.accountId} not found`);
    if (account.data.provider !== "etherfuse") {
      throw new Error(
        `anchorAccounts ${args.accountId} is not an etherfuse account (data.provider=${account.data.provider})`,
      );
    }
    await ctx.db.patch(args.accountId, {
      status: ANCHOR_ONBOARDING_STATUS.APPROVED,
      data: { ...account.data, kycStatus: "approved" },
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Patch the etherfuse variant's kycStatus on an existing `anchorAccounts`
 * row. Re-asserts that the row's discriminator is etherfuse before
 * writing, so a corrupted/mismatched row throws instead of silently
 * overwriting a different provider's data.
 */
export const updateEtherfuseKycStatus = internalMutation({
  args: {
    accountId: v.id("anchorAccounts"),
    kycStatus: v.union(
      v.literal("not_started"),
      v.literal("proposed"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error(`anchorAccounts ${args.accountId} not found`);
    if (account.data.provider !== "etherfuse") {
      throw new Error(
        `anchorAccounts ${args.accountId} is not an etherfuse account (data.provider=${account.data.provider})`,
      );
    }
    await ctx.db.patch(args.accountId, {
      data: { ...account.data, kycStatus: args.kycStatus },
      updatedAt: new Date().toISOString(),
    });
  },
});

/**
 * Insert an `anchorAccounts` row for an agency's Etherfuse proxy. The
 * provisioning action calls this AFTER the on-chain createAccount tx has
 * confirmed, so the row's existence is the on-chain reality. `externalId`
 * holds the customerId UUID that gets registered with Etherfuse in PR-3.
 */
export const insertEtherfuseAccount = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    customerId: v.string(),
    bankAccountId: v.string(),
    publicKey: v.string(),
    encryptedSecret: v.object({
      ciphertext: v.string(),
      iv: v.string(),
      authTag: v.string(),
    }),
  },
  returns: v.id("anchorAccounts"),
  handler: async (ctx, args): Promise<AnchorAccountId> => {
    const now = new Date().toISOString();
    return ctx.db.insert("anchorAccounts", {
      agencyId: args.agencyId,
      provider: "etherfuse",
      status: ANCHOR_ONBOARDING_STATUS.PENDING,
      externalId: args.customerId,
      createdAt: now,
      updatedAt: now,
      data: {
        provider: "etherfuse",
        publicKey: args.publicKey,
        encryptedSecret: args.encryptedSecret,
        bankAccountId: args.bankAccountId,
        kycStatus: "not_started",
      },
    });
  },
});

// ─── Predicates re-export ─────────────────────────────────────────────────────

export { ANCHOR_ONBOARDING_STATUS };
