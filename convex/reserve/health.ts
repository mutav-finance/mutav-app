/**
 * Phase-1 reserve health (ADR 0012): pure math over the Squads vault's BRS
 * balance and the off-chain book. The chain supplies only the balance; the
 * coverage the book requires is computed here, because a multisig keeps no
 * registry of guarantees. Copy built on these figures says the book is
 * "gated by required coverage" — never "solvency".
 */

/**
 * Pilot coverage ratio `c` = 0.25. The program floor is 0.10 (protocol ADR
 * 0016); the pilot starts at 0.25. In phase 1 no program stores `c`, so this
 * constant is the source; the MUTAV vault (phase 3) replaces it with the
 * program's own value through the reader.
 */
export const PILOT_COVERAGE_RATIO_BPS = 2_500;
export const BPS_DENOMINATOR = 10_000;

/** BRS is an SPL token with 6 decimals — the same base unit the offer holds use. */
export const BRS_DECIMALS = 6;
/**
 * 1 BRS = R$1. BRS is a BRL stablecoin and the reader does not price it: a
 * depeg would overstate the balance. Revisit if BRS stops trading at par or
 * the reserve holds a second asset.
 */
export const BRS_CENTS_PER_UNIT = 100;
/** 10^6 base units per BRS ÷ 100 cents per BRS. */
export const BRS_BASE_UNITS_PER_CENT =
  BigInt(10) ** BigInt(BRS_DECIMALS) / BigInt(BRS_CENTS_PER_UNIT);

export const RESERVE_SOURCE_KIND = {
  SQUADS_MULTISIG: "squads_multisig",
} as const satisfies Record<string, string>;

/** BRS base units → BRL cents, rounded down so a balance is never overstated. */
export function brsBaseUnitsToCents(baseUnits: bigint): number {
  return Number(baseUnits / BRS_BASE_UNITS_PER_CENT);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator;
}

/**
 * Σ(in-force cover) × c, rounded up so the reserve is never under-reserved.
 * `insuredCoverCents` is `sumInsuredExposure` — per guarantee, the remaining
 * rent-coverage ceiling plus the exit-cost sublimit.
 */
export function requiredCoverageCents({
  insuredCoverCents,
  coverageRatioBps,
}: {
  insuredCoverCents: number;
  coverageRatioBps: number;
}): number {
  const numerator = BigInt(insuredCoverCents) * BigInt(coverageRatioBps);
  return Number(ceilDiv(numerator, BigInt(BPS_DENOMINATOR)));
}

export type ReserveHealthInputs = {
  balanceCents: number;
  insuredCoverCents: number;
  coverageRatioBps: number;
  /** Offer holds still active (ADR 0010 §4). Zero until the offer-hold ledger lands. */
  activeOfferHoldsCents: number;
};

export type ReserveHealth = ReserveHealthInputs & {
  requiredCoverageCents: number;
  /** balance ÷ required coverage — how many times the requirement is met. Null when nothing is required. */
  coverageRatio: number | null;
  /** balance − required coverage − active offer holds. Negative when the book is over-committed. */
  freeCapitalCents: number;
  /** balance ≥ required coverage. */
  meetsRequiredCoverage: boolean;
};

export function computeReserveHealth(inputs: ReserveHealthInputs): ReserveHealth {
  const required = requiredCoverageCents(inputs);
  return {
    ...inputs,
    requiredCoverageCents: required,
    coverageRatio: required > 0 ? inputs.balanceCents / required : null,
    freeCapitalCents: inputs.balanceCents - required - inputs.activeOfferHoldsCents,
    meetsRequiredCoverage: inputs.balanceCents >= required,
  };
}

/**
 * Phase-1 free capital in BRS base units, before offer holds: the vault
 * balance minus the coverage the in-force book already requires. This is the
 * `freeCapitalBaseUnits` the activation preflight compares against (it then
 * subtracts active holds itself). Computed in base units so the comparison
 * with a hold, also in base units, is exact.
 */
export function phase1FreeCapitalBaseUnits({
  balanceBaseUnits,
  insuredCoverCents,
  coverageRatioBps,
}: {
  balanceBaseUnits: bigint;
  insuredCoverCents: number;
  coverageRatioBps: number;
}): bigint {
  const insuredBaseUnits = BigInt(insuredCoverCents) * BRS_BASE_UNITS_PER_CENT;
  const required = ceilDiv(insuredBaseUnits * BigInt(coverageRatioBps), BigInt(BPS_DENOMINATOR));
  return balanceBaseUnits - required;
}
