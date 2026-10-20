import { internalQuery } from "../_generated/server";
import { getLaunchSettings, reportEnvPresence, type EnvPresence } from "../lib/env";
import { findDefaultProduct } from "../products/useCases";
import { assessReadiness, type ReadinessReport } from "./domain";

/**
 * Go / no-go before onboarding the first real agency, run against the target
 * deployment:
 *
 *   bunx convex run --prod launch/useCases:readiness
 *
 * Reports env presence by name only — no value ever leaves the deployment.
 */
export const readiness = internalQuery({
  args: {},
  handler: async (ctx): Promise<ReadinessReport & { env: EnvPresence[] }> => {
    const env = reportEnvPresence();
    const lock = await ctx.db.query("deploymentLocks").first();
    const staffAdmins = await ctx.db
      .query("mutavStaff")
      .withIndex("by_role", (q) => q.eq("role", "admin"))
      .collect();
    const defaultProduct = await findDefaultProduct(ctx);

    const report = assessReadiness({
      env,
      ...getLaunchSettings(),
      deploymentLocked: lock !== null,
      staffAdminCount: staffAdmins.length,
      defaultProductPresent: defaultProduct !== null,
    });
    return { ...report, env };
  },
});
