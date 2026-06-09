import { query } from "../_generated/server";
import { getMaxGuaranteeCapacityCents } from "../lib/env";
import type { ContractAggregates, HealthTimeline } from "./domain";

const DAY_MS = 24 * 60 * 60 * 1000;

export const getContractAggregates = query({
  args: {},
  handler: async (ctx): Promise<ContractAggregates> => {
    const ativos = await ctx.db
      .query("contracts")
      .withIndex("by_status", (q) => q.eq("status", "ativo"))
      .collect();

    const pendentes = await ctx.db
      .query("contracts")
      .withIndex("by_status", (q) => q.eq("status", "pendente"))
      .collect();

    const sumInsuredCents = ativos.reduce((sum, c) => sum + c.availableGuaranteeCents, 0);

    return {
      countAtivos: ativos.length,
      countPendentes: pendentes.length,
      sumInsuredCents,
      defaultRate: 0, // stub até issue #52 (delinquencies domain)
      maxCapacityCents: getMaxGuaranteeCapacityCents(),
    };
  },
});

export const getTimeline = query({
  args: {},
  handler: async (ctx): Promise<HealthTimeline> => {
    const now = Date.now();

    // Full scan — demo-only; replace with cached counters in production
    const all = await ctx.db.query("contracts").collect();

    const count = (days: number) => all.filter((c) => c._creationTime > now - days * DAY_MS).length;

    return {
      d30: { newContracts: count(30) },
      d90: { newContracts: count(90) },
      d180: { newContracts: count(180) },
    };
  },
});
