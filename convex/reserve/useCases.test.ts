// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("reserve snapshots", () => {
  test("latestSnapshot returns null when none exist", async () => {
    const t = convexTest(schema);
    const latest = await t.query(internal.reserve.useCases.latestSnapshot, {});
    expect(latest).toBeNull();
  });

  test("writeSnapshot inserts and latestSnapshot returns the newest by capturedAt", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 100,
      assets: [{ contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "1000000000" }],
      capturedAt: 1000,
    });
    await t.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 250,
      assets: [{ contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "2500000000" }],
      capturedAt: 2000,
    });
    const latest = await t.query(internal.reserve.useCases.latestSnapshot, {});
    expect(latest?.storedValueCents).toBe(250);
    expect(latest?.capturedAt).toBe(2000);
  });
});
