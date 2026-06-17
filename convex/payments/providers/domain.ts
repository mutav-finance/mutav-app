import { v } from "convex/values";

import {
  ANCHOR_PROVIDER_NAMES,
  type AnchorProviderName,
} from "../../../apps/agency/src/lib/anchors/registry";

// ─── Provider value object ────────────────────────────────────────────────────

/**
 * Re-export the provider name enum from the library registry as an `as const`
 * value object, so domain code can reference `ANCHOR_PROVIDER.TESTANCHOR`
 * instead of the bare string literal.
 *
 * The library is the source of truth — Convex mirrors it via the validator
 * below so schema writes are pinned to the registry's supported set.
 */
export const ANCHOR_PROVIDER = {
  TESTANCHOR: "testanchor",
  ETHERFUSE: "etherfuse",
} as const satisfies Record<string, AnchorProviderName>;

export type AnchorProvider = AnchorProviderName;

export const anchorProviderValidator = v.union(
  ...ANCHOR_PROVIDER_NAMES.map((name) => v.literal(name)),
);
