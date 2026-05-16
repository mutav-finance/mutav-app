import { v } from "convex/values";

import { internalQuery } from "../_generated/server";
import { ANCHOR_PROVIDER, anchorProviderValidator, type AnchorProvider } from "./domain";

/**
 * Returns the anchor provider an agency uses for fiat ↔ token flows.
 *
 * Today every agency falls through to the testanchor — there is no
 * per-agency override yet. When real providers land (Transfero,
 * Etherfuse, a Pix-native anchor), this is the boundary that swaps to
 * reading from agency settings or a dedicated `anchorConfigs` table.
 * Keeping the lookup in `useCases.ts` means the migration only touches
 * this file, not the actions that call it.
 */
export const getProviderForAgency = internalQuery({
  args: { agencyId: v.id("agencies") },
  returns: anchorProviderValidator,
  handler: async (): Promise<AnchorProvider> => {
    return ANCHOR_PROVIDER.TESTANCHOR;
  },
});
