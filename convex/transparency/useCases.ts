import { queryWithAuth } from "../lib/auth";
import { countByStatePlatform, countInsured, sumInsuredExposure } from "../guarantees/aggregate";
import { getMaxGuaranteeCapacityCents, getReserveContractId, getStellarNetwork } from "../lib/env";
import { GUARANTEE_STATE, type GuaranteeState } from "../guarantees/domain";
import type { GuaranteeAggregates, ReserveCoverage } from "./domain";

// Aggregates in this module are platform-wide BY DESIGN — every viewer sees the
// same numbers (transparency dashboard). Do NOT add per-agency filtering here;
// if a scoped variant is needed, add a separate `queryWithAgencyScope` handler
// in a sibling file.

/**
 * Metric definition, quoted verbatim in the SOW evidence pack:
 *
 *   default rate = (default_verified + cover_committed) / in-force guarantees
 *
 * A *count* ratio, not a money ratio: the numerator is guarantees whose
 * default Mutav has confirmed (`default_verified`) or already paid for
 * (`cover_committed`); the denominator is every guarantee currently on risk
 * (`INSURED_STATES`), so the numerator is a subset of it and the rate is
 * bounded by 0..1. Point-in-time, not cohort — it answers "what share of the
 * book is in default right now", not "what share of guarantees ever
 * defaulted", which needs the receivable ledger (spec 9h) to answer honestly.
 *
 * `in_arrears` is deliberately excluded: an arrears notice is the agency's
 * unverified claim, and counting it would let one filing move a published
 * transparency figure. `in_eviction` is excluded too — its cover was already
 * counted while it passed through `cover_committed`, and the eviction is a
 * recovery step, not a second default.
 */
function computeDefaultRate(
  countByState: Record<GuaranteeState, number>,
  insuredCount: number,
): number | null {
  if (insuredCount === 0) return null;
  return (
    (countByState[GUARANTEE_STATE.DEFAULT_VERIFIED] +
      countByState[GUARANTEE_STATE.COVER_COMMITTED]) /
    insuredCount
  );
}

export const getGuaranteeAggregates = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<GuaranteeAggregates> => {
    const countByState = await countByStatePlatform(ctx);
    const insuredCount = await countInsured(ctx);
    return {
      countByState,
      countInsured: insuredCount,
      sumInsuredCents: await sumInsuredExposure(ctx),
      defaultRate: computeDefaultRate(countByState, insuredCount),
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
    };
  },
});

function reserveExplorerUrl(): string {
  const id = getReserveContractId();
  const network = getStellarNetwork() === "public" ? "public" : "testnet";
  // When unconfigured (mainnet, no id) link to the network's contract index root.
  return id
    ? `https://stellar.expert/explorer/${network}/contract/${id}`
    : `https://stellar.expert/explorer/${network}`;
}

// Platform-wide BY DESIGN — every viewer sees the same onchain coverage figure.
export const getReserveCoverage = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<ReserveCoverage> => {
    const explorerUrl = reserveExplorerUrl();
    const snap = await ctx.db
      .query("reserveSnapshots")
      .withIndex("by_capturedAt")
      .order("desc")
      .first();
    // A snapshot with no priced value — empty vault, a wrong-but-responsive
    // contract, or held assets whose symbols aren't in the BRL/USD price lists —
    // must not surface a misleading R$ 0,00 headline. Show "unavailable" instead;
    // the snapshot row still records the held assets for audit.
    if (!snap || snap.storedValueCents <= 0) return { explorerUrl, available: false };
    return {
      explorerUrl,
      available: true,
      storedValueCents: snap.storedValueCents,
      fxUsdBrl: snap.fxUsdBrl,
      fxSource: snap.fxSource,
      fxQuotedAt: snap.fxQuotedAt,
      capturedAt: snap.capturedAt,
      assetCount: snap.assets.length,
    };
  },
});
