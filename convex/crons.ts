import { cronJobs } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Triggered by the monthly cron. Computes the current UTC month and delegates
 * to the core invoice generation mutation.
 */
export const generateCurrentMonthInvoices = internalMutation({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const now = new Date();
    const periodMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return ctx.runMutation(internal.invoices.mutations.generateMonthlyInvoices, { periodMonth });
  },
});

// ─── Schedules ────────────────────────────────────────────────────────────────

const crons = cronJobs();

/**
 * 1st of every month at 06:00 BRT (09:00 UTC).
 * Issues one invoice record per agency for the new billing period.
 */
crons.cron(
  "generate monthly invoices",
  "0 9 1 * *",
  internal.crons.generateCurrentMonthInvoices,
  {},
);

/**
 * Every 30 seconds.
 * Polls Stellar Horizon for incoming muxed payments to the Mutav treasury
 * and marks matching invoices as paid.
 */
crons.interval(
  "poll stellar treasury",
  { seconds: 30 },
  internal.invoices.actions.checkMutavTreasuryPayments,
  {},
);

/**
 * Every day at 00:10 UTC (5 minutes after `mark overdue payments`).
 * Computes the Merkle root over every audit-log entry committed since the
 * previous anchor and anchors it to Stellar via a MEMO_HASH self-payment
 * from a dedicated audit account. Dev/preview without `AUDIT_ANCHOR_SECRET`
 * persists the local root but skips the Stellar submission. See
 * `docs/architecture/security.md` § Audit log integrity.
 */
crons.cron("daily audit anchor", "10 0 * * *", internal.audit.actions.submitDailyAnchor, {});

/**
 * Every 15 minutes. Reads the reserve vault's approved-asset balances over
 * Soroban RPC and writes a `reserveSnapshots` row. On read failure it writes
 * nothing, so the dashboard keeps the last good (timestamped) figure.
 */
crons.interval(
  "refresh reserve snapshot",
  { minutes: 15 },
  internal.reserve.actions.refreshReserveSnapshot,
  {},
);

export default crons;
