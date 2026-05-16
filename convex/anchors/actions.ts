"use node";

import { v } from "convex/values";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { createAnchorClient } from "../../src/lib/anchors/registry";
import { anchorProviderValidator, type AnchorProvider } from "./domain";

interface AnchorCapabilities {
  provider: AnchorProvider;
  networkPassphrase: string | null;
  currencies: Array<{ code: string; issuer?: string }>;
  supports: {
    sep6: boolean;
    sep10: boolean;
    sep12: boolean;
    sep24: boolean;
    sep31: boolean;
    sep38: boolean;
  };
}

/**
 * Discover what the anchor configured for this agency supports.
 *
 * Runs the registry → client → SEP-1 path end-to-end against a real
 * anchor. No auth, no deposit — this proves the wiring works before the
 * signer + on-ramp slice lands. Output is the shape we'll surface in the
 * payment-method picker so the UI knows which currencies/SEPs to offer.
 */
export const discoverCapabilities = internalAction({
  args: { agencyId: v.id("agencies") },
  returns: v.object({
    provider: anchorProviderValidator,
    networkPassphrase: v.union(v.string(), v.null()),
    currencies: v.array(v.object({ code: v.string(), issuer: v.optional(v.string()) })),
    supports: v.object({
      sep6: v.boolean(),
      sep10: v.boolean(),
      sep12: v.boolean(),
      sep24: v.boolean(),
      sep31: v.boolean(),
      sep38: v.boolean(),
    }),
  }),
  handler: async (ctx, args): Promise<AnchorCapabilities> => {
    const provider = await ctx.runQuery(internal.anchors.useCases.getProviderForAgency, {
      agencyId: args.agencyId,
    });

    const client = createAnchorClient(provider);
    const toml = await client.initialize();

    const [sep6, sep10, sep12, sep24, sep31, sep38] = await Promise.all([
      client.supportsSep(6),
      client.supportsSep(10),
      client.supportsSep(12),
      client.supportsSep(24),
      client.supportsSep(31),
      client.supportsSep(38),
    ]);

    return {
      provider,
      networkPassphrase: toml.NETWORK_PASSPHRASE ?? null,
      currencies: (toml.CURRENCIES ?? []).map((c) => ({
        code: c.code ?? "",
        issuer: c.issuer,
      })),
      supports: { sep6, sep10, sep12, sep24, sep31, sep38 },
    };
  },
});
