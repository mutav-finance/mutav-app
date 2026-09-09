import { queryWithAuth } from "../lib/auth";
import { countByStatePlatform, countInsured, sumInsuredExposure } from "../guarantees/aggregate";
import { GUARANTEE_STATE } from "../guarantees/domain";
import { getMaxGuaranteeCapacityCents, getReserveContractId, getStellarNetwork } from "../lib/env";
import type { GuaranteeAggregates, ReserveCoverage } from "./domain";

// Aggregates in this module are platform-wide BY DESIGN — every viewer sees the
// same numbers (transparency dashboard). Do NOT add per-agency filtering here;
// if a scoped variant is needed, add a separate `queryWithAgencyScope` handler
// in a sibling file.

export const getContractAggregates = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<GuaranteeAggregates> => {
    // The default rate needs the receivable ledger (spec 9h) to define its
    // denominator honestly — expose null so the UI shows "—" instead of a
    // misleading 0% on a transparency surface.
    const countByState = await countByStatePlatform(ctx);
    const insured = await countInsured(ctx);
    return {
      countByState,
      countInsured: insured,
      sumInsuredCents: await sumInsuredExposure(ctx),
      defaultRate: null,
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
      countAtivos: insured,
      countPendentes: countByState[GUARANTEE_STATE.DRAFTED],
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
