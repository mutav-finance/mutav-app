import { v } from "convex/values";
import type { Result } from "../lib/result";

/**
 * Pure rules behind the on-chain registration of a guarantee in the MUTAV
 * reserve program (mutav-protocol-solana spec §5.2 `register_guarantee`) and
 * the off-chain offer hold that precedes it (ADR 0010). Nothing here touches
 * the database or the network: `./reader.ts` reads the chain, and
 * `./offerHolds.ts` and `convex/guarantees/registration.ts` do the writes.
 */

/** The reserve's base asset (BRS) has 6 decimals: one cent is 10_000 base units. */
export const BASE_UNITS_PER_CENT = BigInt(10_000);

/** `c` and every other ratio the program exposes is in basis points of 10_000. */
export const RESERVE_BPS_DENOMINATOR = BigInt(10_000);

/** Platform fallback for the offer hold period when no setting overrides it. */
export const OFFER_HOLD_DAYS_DEFAULT = 7;
export const MIN_OFFER_HOLD_DAYS = 1;
export const MAX_OFFER_HOLD_DAYS = 90;
export const MS_PER_DAY = 86_400_000;

/** Prefix of the preimage of a guarantee's 32-byte on-chain id. */
export const ONCHAIN_GUARANTEE_ID_PREFIX = "mutav:guarantee:";

export type ReserveCovers = {
  /** `default_cover`: the coverage ceiling (rent × ceiling multiple) in base units. */
  defaultCoverBaseUnits: bigint;
  /** `exit_cover`: the exit-cost cap (rent × exit multiple) in base units. */
  exitCoverBaseUnits: bigint;
};

export type CoverTerms = { coverageCeilingCents: number; exitCostCapCents: number };

/**
 * The two cover legs `register_guarantee` takes, read from the guarantee's own
 * `terms` snapshot — never from the product, which may have moved since the
 * guarantee was priced. Both cents figures are whole by construction
 * (`priceGuarantee` rounds them), so the conversion is exact.
 */
export function computeCovers(terms: CoverTerms): ReserveCovers {
  return {
    defaultCoverBaseUnits: BigInt(terms.coverageCeilingCents) * BASE_UNITS_PER_CENT,
    exitCoverBaseUnits: BigInt(terms.exitCostCapCents) * BASE_UNITS_PER_CENT,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The guarantee's 32-byte id on chain, as lowercase hex:
 * `sha256("mutav:guarantee:" + publicId)` — the same convention as the pilot
 * reserve app's `REF.guaranteeId`, so staff can paste the value into the
 * operator console and the two sides agree without a lookup table.
 */
export async function onchainGuaranteeIdHex(publicId: string): Promise<string> {
  const encoded = new TextEncoder().encode(`${ONCHAIN_GUARANTEE_ID_PREFIX}${publicId}`);
  // Copied into a plain ArrayBuffer: `digest` refuses a view over a shared buffer.
  const preimage = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(preimage).set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", preimage);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * The free capital an offer must hold: `ceil(c × (default_cover + exit_cover) / 10_000)`,
 * the program's coverage requirement for this guarantee alone. Rounded up so
 * the hold never under-reserves against the on-chain gate.
 */
export function holdAmountBaseUnits({
  covers,
  coverageRatioBps,
}: {
  covers: ReserveCovers;
  coverageRatioBps: number;
}): bigint {
  const totalCover = covers.defaultCoverBaseUnits + covers.exitCoverBaseUnits;
  const numerator = BigInt(coverageRatioBps) * totalCover;
  return (numerator + RESERVE_BPS_DENOMINATOR - BigInt(1)) / RESERVE_BPS_DENOMINATOR;
}

export type PreflightSuccess = { remainingFreeCapitalBaseUnits: bigint };
export type PreflightError = {
  code: typeof OFFER_HOLD_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL;
  shortfallBaseUnits: bigint;
};

export const OFFER_HOLD_ERROR_CODE = {
  INSUFFICIENT_FREE_CAPITAL: "INSUFFICIENT_FREE_CAPITAL",
  INVALID_HOLD_DAYS: "INVALID_HOLD_DAYS",
  TOO_MANY_OPEN_HOLDS: "TOO_MANY_OPEN_HOLDS",
} as const satisfies Record<string, string>;

/**
 * Does a new hold fit? Free capital as the chain reports it, minus every
 * offer hold Convex still counts as active, must cover the new one. Two
 * offers therefore cannot both pass and then race at registration — sound
 * only while MUTAV's operator is the sole `register_guarantee` caller (ADR 0010).
 */
export function preflightOfferHold({
  freeCapitalBaseUnits,
  activeHoldsBaseUnits,
  newHoldBaseUnits,
}: {
  freeCapitalBaseUnits: bigint;
  activeHoldsBaseUnits: bigint;
  newHoldBaseUnits: bigint;
}): Result<PreflightSuccess, PreflightError> {
  const available = freeCapitalBaseUnits - activeHoldsBaseUnits;
  if (newHoldBaseUnits > available) {
    const shortfallBaseUnits = newHoldBaseUnits - (available > BigInt(0) ? available : BigInt(0));
    return {
      success: false,
      error: { code: OFFER_HOLD_ERROR_CODE.INSUFFICIENT_FREE_CAPITAL, shortfallBaseUnits },
      message: `Offer needs ${newHoldBaseUnits} base units; ${available} are free after active holds`,
    };
  }
  return {
    success: true,
    data: { remainingFreeCapitalBaseUnits: available - newHoldBaseUnits },
    message: "Offer hold fits the reserve's free capital",
  };
}

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
  REGISTERED: "registered",
  EXPIRED: "expired",
  CANCELED: "canceled",
  REFUSED: "refused",
  RESENT: "resent",
} as const;

export type OfferHoldReleaseReason =
  (typeof OFFER_HOLD_RELEASE_REASON)[keyof typeof OFFER_HOLD_RELEASE_REASON];

export const offerHoldReleaseReasonValidator = v.union(
  v.literal(OFFER_HOLD_RELEASE_REASON.REGISTERED),
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
 * held allocation belongs to the pending registration.
 */
export function isOfferHoldActive(hold: OfferHoldTiming, now: number): boolean {
  if (hold.releasedAt !== undefined) return false;
  if (hold.signedAt !== undefined) return true;
  return hold.expiresAt > now;
}

/** Unreleased, unsigned and past its period: the sweep's target, and the admin flag. */
export function isOfferHoldLapsed(hold: OfferHoldTiming, now: number): boolean {
  return hold.releasedAt === undefined && hold.signedAt === undefined && hold.expiresAt <= now;
}

export type OfferHoldStatus = "none" | "active" | "lapsed" | "released";

/** One word for what the admin console shows about an offer's latest hold. */
export function offerHoldStatus(hold: OfferHoldTiming | null, now: number): OfferHoldStatus {
  if (!hold) return "none";
  if (isOfferHoldActive(hold, now)) return "active";
  if (isOfferHoldLapsed(hold, now)) return "lapsed";
  return "released";
}

export function offerHoldExpiresAt({ sentAt, holdDays }: { sentAt: number; holdDays: number }) {
  return sentAt + holdDays * MS_PER_DAY;
}

/**
 * Anchor custom-error numbering: the program's error enum starts at 6000.
 * Names copied in enum order from the generated client
 * (`@mutav-finance/mutav-protocol-solana`, `generated/errors/mutav.ts`);
 * the list is append-only from the first devnet deploy (spec §10).
 */
export const RESERVE_PROGRAM_ERROR_OFFSET = 6000;

export const RESERVE_PROGRAM_ERROR_NAMES = [
  "Unauthorized",
  "RolesNotDistinct",
  "Paused",
  "InvalidParameter",
  "InvalidMint",
  "UnsupportedMintExtension",
  "ReserveFrozen",
  "UnderCovered",
  "InsufficientFreeCapital",
  "InsufficientLiquidBalance",
  "FulfilHalted",
  "TvlCapExceeded",
  "GuaranteeCapExceeded",
  "GuaranteeNotActive",
  "OpenClaims",
  "ExceedsRemainingCover",
  "ClaimNotFiled",
  "ClaimCallCapExceeded",
  "ClaimPeriodCapExceeded",
  "InvalidPaymentsAccount",
  "PayoutAlreadySettled",
  "NotAllowlisted",
  "RequestTooSmall",
  "RequestTooLarge",
  "InvalidRequestStatus",
  "QueueOrderViolation",
  "PostCpiCheckFailed",
  "MathOverflow",
  "FeatureNotSupported",
  "InvalidTreasuryAccount",
  "UnsupportedVersion",
  "InvalidIncomeSource",
  "IncomeExceedsInbox",
  "InvalidTokenProgram",
  "ClaimNotPaid",
  "DuplicateParam",
  "ExpectedAmountMismatch",
  "NavOutOfBounds",
  "NoPendingHandover",
  "HandoverExpired",
  "GuaranteeHasPayments",
  "HandoverPending",
  "RefreshRequired",
  "PriceLimitNotMet",
  "ReserveUnderwater",
  "NoSharesOutstanding",
  "ClaimRevisionMismatch",
] as const;

export type ReserveProgramErrorName = (typeof RESERVE_PROGRAM_ERROR_NAMES)[number];

/** The errors spec §5.2 lists for `register_guarantee` — the ones a refusal can carry. */
export const REGISTER_GUARANTEE_ERRORS: readonly ReserveProgramErrorName[] = [
  "Paused",
  "UnderCovered",
  "ReserveFrozen",
  "InvalidParameter",
  "GuaranteeCapExceeded",
  "InsufficientFreeCapital",
];

export const UNKNOWN_PROGRAM_ERROR_NAME = "UnknownProgramError";

/** `6008` → `InsufficientFreeCapital`; anything outside the enum is named as unknown. */
export function reserveProgramErrorName(code: number): string {
  const name = RESERVE_PROGRAM_ERROR_NAMES[code - RESERVE_PROGRAM_ERROR_OFFSET];
  return name ?? UNKNOWN_PROGRAM_ERROR_NAME;
}

/** A Solana transaction signature: 64 bytes in base58, 87–88 characters. */
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

export function isTxSignatureShape(value: string): boolean {
  return BASE58_SIGNATURE.test(value);
}
