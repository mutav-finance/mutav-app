import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { anchorProviderValidator } from "./domain";

// ─── Type aliases ─────────────────────────────────────────────────────────────

export type AnchorAccount = Doc<"anchorAccounts">;
export type AnchorAccountId = Id<"anchorAccounts">;
export type AnchorOnboardingStatus = AnchorAccount["status"];

// ─── Onboarding status value object ───────────────────────────────────────────

/**
 * Lifecycle of an agency's onboarding with a single anchor provider.
 * Normalized across providers so the UI can render a single status pill
 * regardless of which anchor we're talking to.
 */
export const ANCHOR_ONBOARDING_STATUS = {
  NOT_STARTED: "not_started",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const satisfies Record<Uppercase<string>, AnchorOnboardingStatus>;

export const anchorOnboardingStatusValidator = v.union(
  v.literal(ANCHOR_ONBOARDING_STATUS.NOT_STARTED),
  v.literal(ANCHOR_ONBOARDING_STATUS.PENDING),
  v.literal(ANCHOR_ONBOARDING_STATUS.APPROVED),
  v.literal(ANCHOR_ONBOARDING_STATUS.REJECTED),
);

// ─── Provider-specific data (discriminated by provider) ───────────────────────

/**
 * Provider-specific fields live in a discriminated union keyed by `provider`.
 * Adding a new anchor = (1) register its name in `src/lib/anchors/registry.ts`
 * and (2) add a variant here. No agency-row migration required.
 *
 * `testanchor` carries no per-agency state — it's the dev/preview fallback.
 * Variant exists for symmetry so the union has a default arm.
 */
export const anchorAccountDataValidator = v.union(
  v.object({
    provider: v.literal("testanchor"),
  }),
);

// ─── Predicates ───────────────────────────────────────────────────────────────

export function isOnboarded(status: AnchorOnboardingStatus): boolean {
  return status === ANCHOR_ONBOARDING_STATUS.APPROVED;
}

// ─── Re-exports for downstream domains ────────────────────────────────────────

export { anchorProviderValidator };
