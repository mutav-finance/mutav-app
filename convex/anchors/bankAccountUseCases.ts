import { v } from "convex/values";

import { internalMutation, internalQuery, query } from "../_generated/server";
import {
  agencyBankAccountTypeValidator,
  type AgencyBankAccount,
  type AgencyBankAccountId,
} from "./bankAccountDomain";

/**
 * Public list for the checkout bank picker. Reactive — re-fires after
 * `syncEtherfuseBankAccounts` upserts so the picker repopulates without
 * a manual refetch.
 */
export const listByAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args): Promise<AgencyBankAccount[]> => {
    return ctx.db
      .query("agencyBankAccounts")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .collect();
  },
});

/**
 * Used by `startEtherfusePixOnramp` to validate that the bankAccountId
 * the client picked still exists and still belongs to the payment's
 * agency. Internal so external callers can't enumerate by id.
 */
export const getById = internalQuery({
  args: { bankAccountId: v.id("agencyBankAccounts") },
  handler: async (ctx, args): Promise<AgencyBankAccount | null> => {
    return ctx.db.get(args.bankAccountId);
  },
});

/**
 * Insert if `externalBankAccountId` is unknown, otherwise patch the
 * cached fields. Matched on the unique upstream identifier so a
 * re-sync after the operator edits a bank in Etherfuse's UI is safe.
 */
export const upsertFromEtherfuse = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    anchorAccountId: v.id("anchorAccounts"),
    externalBankAccountId: v.string(),
    type: agencyBankAccountTypeValidator,
    accountNumber: v.string(),
    accountHolderName: v.string(),
    etherfuseCreatedAt: v.string(),
  },
  returns: v.id("agencyBankAccounts"),
  handler: async (ctx, args): Promise<AgencyBankAccountId> => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("agencyBankAccounts")
      .withIndex("by_external_id", (q) => q.eq("externalBankAccountId", args.externalBankAccountId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        type: args.type,
        accountNumber: args.accountNumber,
        accountHolderName: args.accountHolderName,
        etherfuseCreatedAt: args.etherfuseCreatedAt,
        syncedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("agencyBankAccounts", {
      ...args,
      syncedAt: now,
    });
  },
});

/**
 * Drop local rows whose `externalBankAccountId` no longer appears in
 * the upstream list. Called by the sync action after upserting every
 * remote bank, so the local cache stays a faithful mirror of what
 * Etherfuse reports.
 */
export const removeMissingExternalIds = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    keepExternalIds: v.array(v.string()),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const keep = new Set(args.keepExternalIds);
    const local = await ctx.db
      .query("agencyBankAccounts")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .collect();
    let removed = 0;
    for (const row of local) {
      if (!keep.has(row.externalBankAccountId)) {
        await ctx.db.delete(row._id);
        removed++;
      }
    }
    return removed;
  },
});
