import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { reserveReader } from "./reader";

/**
 * Cron entry point: read the reserve through the port and persist a health
 * snapshot. On a failed read it writes nothing, so pages keep showing the
 * last good (timestamped) reading — never a guessed balance. The reader logs
 * the failure.
 */
export const refreshReserveHealth = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const capacity = await reserveReader.readCapacity();
    if (!capacity.success) return;
    await ctx.runMutation(internal.reserve.useCases.writeHealthSnapshot, {
      capturedAt: Date.now(),
      source: capacity.data.source,
      balanceBaseUnits: capacity.data.balanceBaseUnits.toString(),
      coverageRatioBps: capacity.data.coverageRatioBps,
    });
  },
});
