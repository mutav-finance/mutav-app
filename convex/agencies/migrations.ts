import { internalMutation } from "../_generated/server";

type LegacyBankingInfo = {
  bank: string;
  branch: string;
  account: string;
  accountType: "corrente" | "poupanca";
  pixKey?: string;
};

/**
 * One-shot migration: renames bankingInfo.branch → bankingInfo.agency for all
 * agency documents written before the schema rename landed in feat/health-dashboard.
 * Run once via the Convex dashboard: internal.agencies.migrations.backfillBankingAgencyField
 */
export const backfillBankingAgencyField = internalMutation({
  args: {},
  handler: async (ctx) => {
    const agencies = await ctx.db.query("agencies").collect();
    let patched = 0;

    for (const agency of agencies) {
      const info = agency.bankingInfo as unknown as LegacyBankingInfo | undefined; // hook-ok: legacy field read at migration boundary
      if (!info || !("branch" in info) || "agency" in info) continue;

      const { branch, ...rest } = info;
      await ctx.db.patch(agency._id, {
        bankingInfo: { ...rest, agency: branch },
      });
      patched++;
    }

    return { patched, total: agencies.length };
  },
});
