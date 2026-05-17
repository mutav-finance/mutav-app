import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import { ANCHOR_PROVIDER, anchorProviderValidator, type AnchorProvider } from "./domain";

/**
 * Returns the anchor provider an agency uses for fiat ↔ token flows.
 *
 * Lookup order:
 *  1. If the agency has an `anchorAccounts` row for etherfuse — regardless
 *     of onboarding status — use etherfuse. The action layer enforces the
 *     KYC-approved precondition at call time and returns a structured
 *     "onboarding incomplete" error if the row exists but isn't approved.
 *  2. Otherwise fall through to testanchor (dev/preview default).
 *
 * Deliberately doesn't fall back to testanchor when etherfuse exists but
 * is in an error state — silent fallback would route real production
 * payments to the testnet anchor, which is a money-loss class of bug.
 */
export const getProviderForAgency = internalQuery({
  args: { agencyId: v.id("agencies") },
  returns: anchorProviderValidator,
  handler: async (ctx, args): Promise<AnchorProvider> => {
    const etherfuseRow = await ctx.db
      .query("anchorAccounts")
      .withIndex("by_agency_provider", (q) =>
        q.eq("agencyId", args.agencyId).eq("provider", ANCHOR_PROVIDER.ETHERFUSE),
      )
      .unique();
    if (etherfuseRow) return ANCHOR_PROVIDER.ETHERFUSE;
    return ANCHOR_PROVIDER.TESTANCHOR;
  },
});
