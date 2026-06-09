import { internalMutation } from "../_generated/server";

type LegacyBankingInfo = {
  bank: string;
  branch?: string;
  agency?: string;
  account: string;
  accountType: "corrente" | "poupanca";
  pixKey?: string;
};

/**
 * Idempotent one-shot backfill of `branch` → `agency` on `bankingInfo`.
 * Safe to re-run.
 */
export const backfillBankingAgencyField = internalMutation({
  args: {},
  handler: async (ctx) => {
    const agencies = await ctx.db.query("agencies").collect();
    let patched = 0;
    let alreadyMigrated = 0;
    let noBankingInfo = 0;
    let malformed = 0;

    for (const agency of agencies) {
      const info = agency.bankingInfo as unknown as LegacyBankingInfo | undefined; // hook-ok: legacy field read at migration boundary
      if (!info) {
        noBankingInfo++;
        continue;
      }

      const hasBranch = "branch" in info && info.branch !== undefined;
      const hasAgency = "agency" in info && info.agency !== undefined;

      if (hasBranch && hasAgency) {
        console.error(
          `[migration] agency ${agency._id} has both branch and agency — manual fix required`,
        );
        malformed++;
        continue;
      }

      if (hasAgency) {
        alreadyMigrated++;
        continue;
      }

      if (hasBranch && info.branch !== undefined) {
        await ctx.db.patch(agency._id, {
          bankingInfo: {
            bank: info.bank,
            agency: info.branch,
            account: info.account,
            accountType: info.accountType,
            ...(info.pixKey !== undefined ? { pixKey: info.pixKey } : {}),
          },
        });
        patched++;
        continue;
      }

      malformed++;
    }

    return {
      patched,
      alreadyMigrated,
      noBankingInfo,
      malformed,
      total: agencies.length,
    };
  },
});
