import { v } from "convex/values";
import type { Result } from "../lib/result";

/**
 * Pure rules behind the phase-1 activation gate (issue #427, ADR amendment
 * pending): the reserve is a Squads multisig vault on Solana holding BRS and
 * there is no MUTAV program, so a guarantee goes active when compliance
 * approves its signed contract AND it fits the reserve's free capital —
 * gated by required coverage. Nothing here touches the database or the
 * network: `./balance.ts` reads and writes the cached vault balance, and
 * `./offerHolds.ts` and `convex/guarantees/activation.ts` do the writes.
 *
 * Every figure is BRL cents. BRS is 1:1 with BRL, so the vault balance the
 * reader records is already in cents and no base-unit conversion happens on
 * this side.
 *
 *   free capital        = vault balance − required coverage − active offer holds
 *   required coverage   = ceil(Σ remaining cover of on-risk guarantees × c)
 *   own requirement     = ceil((coverage ceiling + exit-cost cap) × c)
 *   passes              ⇔ own requirement ≤ free capital
 */

export const BPS_DENOMINATOR = 10_000;

/** Pilot coverage ratio `c` (25%); `platformSettings.coverageRatioBps` overrides it. */
export const COVERAGE_RATIO_BPS_DEFAULT = 2_500;

/**
 * How old the newest vault balance may be before the gate refuses to read it.
 * The reader writes one every 15 minutes, so two missed reads fail closed.
 */
export const RESERVE_BALANCE_MAX_AGE_MS = 30 * 60 * 1_000;

/** Platform fallback for the offer hold period when no setting overrides it. */
export const OFFER_HOLD_DAYS_DEFAULT = 7;
export const MIN_OFFER_HOLD_DAYS = 1;
export const MAX_OFFER_HOLD_DAYS = 90;
export const MS_PER_DAY = 86_400_000;

export const RESERVE_CAPACITY_ERROR_CODE = {
  /** No vault balance recorded, or the newest one is older than the bound. */
  RESERVE_BALANCE_UNAVAILABLE: "RESERVE_BALANCE_UNAVAILABLE",
  INSUFFICIENT_FREE_CAPITAL: "INSUFFICIENT_FREE_CAPITAL",
  INVALID_RESERVE_BALANCE: "INVALID_RESERVE_BALANCE",
  INVALID_COVERAGE_RATIO: "INVALID_COVERAGE_RATIO",
} as const satisfies Record<string, string>;

export const OFFER_HOLD_ERROR_CODE = {
  INVALID_HOLD_DAYS: "INVALID_HOLD_DAYS",
  TOO_MANY_OPEN_HOLDS: "TOO_MANY_OPEN_HOLDS",
} as const satisfies Record<string, string>;

export function isValidCoverageRatioBps(bps: number): boolean {
  return Number.isInteger(bps) && bps > 0 && bps <= BPS_DENOMINATOR;
}

export function isValidBalanceCents(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= 0;
}

function ceilBps({ cents, bps }: { cents: number; bps: number }): number {
  return Math.ceil((cents * bps) / BPS_DENOMINATOR);
}

export type CoverTerms = { coverageCeilingCents: number; exitCostCapCents: number };

/**
 * What one guarantee asks of the reserve when it goes on risk: its full
 * cover — the coverage ceiling plus the exit-cost cap, from its own `terms`
 * snapshot — times `c`, rounded up so the gate never under-reserves.
 */
export function coverRequirementCents({
  terms,
  coverageRatioBps,
}: {
  terms: CoverTerms;
  coverageRatioBps: number;
}): number {
  return ceilBps({
    cents: terms.coverageCeilingCents + terms.exitCostCapCents,
    bps: coverageRatioBps,
  });
}

/**
 * The reserve's required coverage: the remaining cover of every guarantee on
 * risk (`active` through `in_eviction` — what `sumInsuredExposure` sums:
 * available coverage plus the exit-cost cap) times `c`, rounded up.
 */
export function requiredCoverageCents({
  onRiskCoverCents,
  coverageRatioBps,
}: {
  onRiskCoverCents: number;
  coverageRatioBps: number;
}): number {
  return ceilBps({ cents: onRiskCoverCents, bps: coverageRatioBps });
}

/** Every figure one capacity check used — stored on the guarantee and shown to staff. */
export type CapacityFigures = {
  snapshotTakenAt: number;
  balanceCents: number;
  coverageRatioBps: number;
  requiredCoverageCents: number;
  activeHoldsCents: number;
  /** May be negative: the reserve can already sit under its required coverage. */
  freeCapitalCents: number;
  ownRequirementCents: number;
};

export function freeCapitalCents({
  balanceCents,
  requiredCoverageCents: required,
  activeHoldsCents,
}: {
  balanceCents: number;
  requiredCoverageCents: number;
  activeHoldsCents: number;
}): number {
  return balanceCents - required - activeHoldsCents;
}

export type CapacityShortfall = {
  code: typeof RESERVE_CAPACITY_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL;
  /** How much more vault balance would make the guarantee fit. */
  shortfallCents: number;
};

/**
 * Does the guarantee fit? Its own requirement must not exceed the free
 * capital measured without its own offer hold. The same rule gates the offer
 * (the preflight at send-for-signature) and the activation.
 */
export function checkReserveCapacity(
  figures: Pick<CapacityFigures, "freeCapitalCents" | "ownRequirementCents">,
): Result<{ remainingCents: number }, CapacityShortfall> {
  if (figures.ownRequirementCents > figures.freeCapitalCents) {
    const shortfallCents = figures.ownRequirementCents - figures.freeCapitalCents;
    return {
      success: false,
      error: { code: RESERVE_CAPACITY_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL, shortfallCents },
      message: `Needs ${figures.ownRequirementCents} cents; ${figures.freeCapitalCents} are free`,
    };
  }
  return {
    success: true,
    data: { remainingCents: figures.freeCapitalCents - figures.ownRequirementCents },
    message: "Fits the reserve's free capital",
  };
}

export type ReserveBalanceReading = { balanceCents: number; takenAt: number };

/** Older than the bound, or stamped in the future: either way, not a reading to trust. */
export function isReserveBalanceFresh(reading: ReserveBalanceReading, now: number): boolean {
  return reading.takenAt <= now && now - reading.takenAt <= RESERVE_BALANCE_MAX_AGE_MS;
}

// ---------------------------------------------------------------------------
// Offer holds
// ---------------------------------------------------------------------------

export function isValidOfferHoldDays(days: number): boolean {
  return Number.isInteger(days) && days >= MIN_OFFER_HOLD_DAYS && days <= MAX_OFFER_HOLD_DAYS;
}

export type OfferHoldDaysSettings = {
  contract?: number;
  agency?: number;
  product?: number;
  platform?: number;
};

export type OfferHoldDaysSource = keyof OfferHoldDaysSettings | "default";

/**
 * The hold period an offer gets: the most specific setting wins —
 * contract, then agency, then product, then the platform setting, then
 * `OFFER_HOLD_DAYS_DEFAULT`. The caller fixes the result on the hold row when
 * the offer is sent, so a later settings change never moves a live offer.
 */
export function resolveOfferHoldDays(settings: OfferHoldDaysSettings): {
  days: number;
  source: OfferHoldDaysSource;
} {
  if (settings.contract !== undefined) return { days: settings.contract, source: "contract" };
  if (settings.agency !== undefined) return { days: settings.agency, source: "agency" };
  if (settings.product !== undefined) return { days: settings.product, source: "product" };
  if (settings.platform !== undefined) return { days: settings.platform, source: "platform" };
  return { days: OFFER_HOLD_DAYS_DEFAULT, source: "default" };
}

export const OFFER_HOLD_RELEASE_REASON = {
  ACTIVATED: "activated",
  EXPIRED: "expired",
  CANCELED: "canceled",
  REFUSED: "refused",
  RESENT: "resent",
} as const;

export type OfferHoldReleaseReason =
  (typeof OFFER_HOLD_RELEASE_REASON)[keyof typeof OFFER_HOLD_RELEASE_REASON];

export const offerHoldReleaseReasonValidator = v.union(
  v.literal(OFFER_HOLD_RELEASE_REASON.ACTIVATED),
  v.literal(OFFER_HOLD_RELEASE_REASON.EXPIRED),
  v.literal(OFFER_HOLD_RELEASE_REASON.CANCELED),
  v.literal(OFFER_HOLD_RELEASE_REASON.REFUSED),
  v.literal(OFFER_HOLD_RELEASE_REASON.RESENT),
);

export type OfferHoldTiming = {
  expiresAt: number;
  releasedAt?: number;
  signedAt?: number;
};

/**
 * A hold counts against free capital until it is released. An unreleased
 * hold past its expiry is treated as released even before the sweep writes
 * it — unless the contract was signed within the period, in which case the
 * held capital belongs to the guarantee waiting for reserve capacity.
 */
export function isOfferHoldActive(hold: OfferHoldTiming, now: number): boolean {
  if (hold.releasedAt !== undefined) return false;
  if (hold.signedAt !== undefined) return true;
  return hold.expiresAt > now;
}

/** Unreleased, unsigned and past its period: the sweep's target, and the staff flag. */
export function isOfferHoldLapsed(hold: OfferHoldTiming, now: number): boolean {
  return hold.releasedAt === undefined && hold.signedAt === undefined && hold.expiresAt <= now;
}

export type OfferHoldStatus = "none" | "active" | "lapsed" | "released";

/** One word for what the admin app shows about an offer's latest hold. */
export function offerHoldStatus(hold: OfferHoldTiming | null, now: number): OfferHoldStatus {
  if (!hold) return "none";
  if (isOfferHoldActive(hold, now)) return "active";
  if (isOfferHoldLapsed(hold, now)) return "lapsed";
  return "released";
}

export function offerHoldExpiresAt({ sentAt, holdDays }: { sentAt: number; holdDays: number }) {
  return sentAt + holdDays * MS_PER_DAY;
}
