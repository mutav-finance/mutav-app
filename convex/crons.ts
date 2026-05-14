import { cronJobs } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Triggered by the monthly cron. Computes the current UTC month and delegates
 * to the core payment generation mutation.
 */
export const generateCurrentMonthPayments = internalMutation({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const now = new Date();
    const periodMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    return ctx.runMutation(internal.payments.mutations.generateMonthlyPayments, { periodMonth });
  },
});

/**
 * Exposed as an internal mutation so the cron can reference it directly via
 * `internal.crons.*` without circularity. Delegates to the payments module.
 */
export const runMarkOverdue = internalMutation({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    return ctx.runMutation(internal.payments.mutations.markOverduePayments, {});
  },
});

// ─── Schedules ────────────────────────────────────────────────────────────────

const crons = cronJobs();

/**
 * 1st of every month at 06:00 BRT (09:00 UTC).
 * Issues one payment record per agency for the new billing period.
 */
crons.cron(
  "generate monthly payment invoices",
  "0 9 1 * *",
  internal.crons.generateCurrentMonthPayments,
  {},
);

/**
 * Every day at 00:05 UTC.
 * Flips pending payments to overdue once their due date has passed.
 */
crons.cron("mark overdue payments", "5 0 * * *", internal.crons.runMarkOverdue, {});

/**
 * Every 30 seconds.
 * Polls Stellar Horizon for incoming muxed payments to the Mutav treasury
 * and marks matching invoices as paid.
 */
crons.interval(
  "poll stellar treasury",
  { seconds: 30 },
  internal.payments.actions.checkMutavTreasuryPayments,
  {},
);

export default crons;
