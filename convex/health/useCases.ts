import { queryWithAuth } from "../lib/auth";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import type { ContractAggregates, HealthTimeline, TimelineWeek } from "./domain";

// Aggregates in this module are platform-wide BY DESIGN — every viewer sees the
// same numbers (transparency dashboard). Do NOT add per-agency filtering here;
// if a scoped variant is needed, add a separate `queryWithAgencyScope` handler
// in a sibling file.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TIMELINE_WEEKS = 52;

/**
 * Returns the UTC Monday at 00:00:00 for the week containing `at`.
 * Anchor convention: ISO-8601 weeks start on Monday.
 */
function utcMondayStart(at: Date): Date {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const dow = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const daysSinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

export const getContractAggregates = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<ContractAggregates> => {
    const contracts = await ctx.db.query("contracts").collect();

    let countAtivos = 0;
    let countPendentes = 0;
    let sumInsuredCents = 0;
    for (const c of contracts) {
      if (c.status === "ativo") {
        countAtivos++;
        sumInsuredCents += c.availableGuaranteeCents;
      } else if (c.status === "pendente") {
        countPendentes++;
      }
    }

    // defaultRate is derived as 0 because the contracts schema has no
    // `inadimplente` state yet — default tracking lands in a future PR.
    const defaultRate = 0;

    return {
      countAtivos,
      countPendentes,
      sumInsuredCents,
      defaultRate,
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
    };
  },
});

export const getTimeline = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<HealthTimeline> => {
    const contracts = await ctx.db.query("contracts").collect();

    const currentWeekStart = utcMondayStart(new Date());
    const buckets: TimelineWeek[] = [];

    for (let i = TIMELINE_WEEKS - 1; i >= 0; i--) {
      const startMs = currentWeekStart.getTime() - i * WEEK_MS;
      const endMs = startMs + WEEK_MS;
      const startISO = new Date(startMs).toISOString();
      const endISO = new Date(endMs).toISOString();

      let activeContracts = 0;
      let cancelledContracts = 0;
      for (const c of contracts) {
        if (c.activatedAt && c.activatedAt >= startISO && c.activatedAt < endISO) {
          activeContracts++;
        }
        if (
          c.deactivatedAt &&
          c.deactivatedAt >= startISO &&
          c.deactivatedAt < endISO &&
          c.status === "cancelado"
        ) {
          cancelledContracts++;
        }
      }

      buckets.push({
        weekStartISO: startISO.slice(0, 10),
        activeContracts,
        cancelledContracts,
        // No `inadimplente` state exists in the contracts schema today;
        // delinquency tracking is a separate future PR.
        delinquentContracts: 0,
      });
    }

    return buckets;
  },
});
