import { queryWithAuth } from "../lib/auth";
import {
  countByStatePlatform,
  countInsured,
  sumInsuredExposure,
  sumVerifiedDefaultExposure,
} from "../guarantees/aggregate";
import { getReserveContractId, getStellarNetwork } from "../lib/env";
import { VERIFIED_DEFAULT_STATES, type GuaranteeState } from "../guarantees/domain";
import { deriveSolvencyFigures, type ReserveSolvencySnapshot } from "../reserve/domain";
import type {
  GuaranteeAggregates,
  ReserveCoverage,
  ReserveSolvency,
  StellarNetworkName,
} from "./domain";

// Aggregates in this module are platform-wide BY DESIGN — every viewer sees the
// same numbers (transparency dashboard). Do NOT add per-agency filtering here;
// if a scoped variant is needed, add a separate `queryWithAgencyScope` handler
// in a sibling file.
//
// Every figure below is defined — formula, source, refresh cadence — in
// docs/transparency-metrics.md. Change the two together.

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
function computeDefaultRate(verifiedDefaultCount: number, insuredCount: number): number | null {
  if (insuredCount === 0) return null;
  return verifiedDefaultCount / insuredCount;
}

function countVerifiedDefault(countByState: Record<GuaranteeState, number>): number {
  return VERIFIED_DEFAULT_STATES.reduce((sum, state) => sum + countByState[state], 0);
}

export const getGuaranteeAggregates = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<GuaranteeAggregates> => {
    const countByState = await countByStatePlatform(ctx);
    const insuredCount = await countInsured(ctx);
    const verifiedDefaultCount = countVerifiedDefault(countByState);
    return {
      countByState,
      countInsured: insuredCount,
      sumInsuredCents: await sumInsuredExposure(ctx),
      countVerifiedDefault: verifiedDefaultCount,
      // Same aggregate and exposure formula as `sumInsuredCents`, narrowed to
      // the verified-default states — a subset of it, in the same BRL centavos.
      verifiedDefaultExposureCents: await sumVerifiedDefaultExposure(ctx),
      defaultRate: computeDefaultRate(verifiedDefaultCount, insuredCount),
    };
  },
});

function explorerRoot(network: StellarNetworkName): string {
  return `https://stellar.expert/explorer/${network}`;
}

function contractExplorerUrl(network: StellarNetworkName, id: string): string {
  return `${explorerRoot(network)}/contract/${id}`;
}

function reserveExplorerUrl(): string {
  const id = getReserveContractId();
  const network = getStellarNetwork();
  // When unconfigured (mainnet, no id) link to the network's contract index root.
  return id ? contractExplorerUrl(network, id) : explorerRoot(network);
}

// Contract ids come from the snapshot, not env: the page must name the
// contracts the figures were actually read from, even if env moved since.
function shapeReserveSolvency(snapshot: ReserveSolvencySnapshot): ReserveSolvency {
  const network = getStellarNetwork();
  const figures = deriveSolvencyFigures(snapshot);
  const reference = (id: string) => ({ id, explorerUrl: contractExplorerUrl(network, id) });
  return {
    ...figures,
    network,
    assetSymbol: snapshot.assetSymbol,
    contracts: {
      vault: reference(snapshot.vaultId),
      policy: reference(snapshot.policyId),
      registry: reference(snapshot.registryId),
    },
    positions: figures.positions.map((position) => ({
      ...position,
      explorerUrl: contractExplorerUrl(network, position.address),
    })),
  };
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
      solvency: snap.solvency ? shapeReserveSolvency(snap.solvency) : null,
    };
  },
});
