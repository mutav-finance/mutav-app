// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import { registerGuaranteeAggregateComponents } from "../lib/testFixtures";
import schema from "../schema";

describe("readiness", () => {
  test("a fresh deployment is not ready: unlocked, no admin, no product", async () => {
    const t = convexTest(schema);

    const report = await t.query(internal.launch.useCases.readiness, {});

    expect(report.ready).toBe(false);
    expect(report.blockers.map((b) => b.code)).toEqual(
      expect.arrayContaining(["DEPLOYMENT_NOT_LOCKED", "NO_STAFF_ADMIN", "NO_DEFAULT_PRODUCT"]),
    );
  });

  test("the lock, the default product and a bootstrapped admin clear their blockers", async () => {
    const t = convexTest(schema);
    registerGuaranteeAggregateComponents(t);
    await t.mutation(internal.seed.lockForRealData, { confirm: "LOCK" });
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        publicId: "U-ADMIN",
        subject: "auth0|real-admin",
        email: "ops@example.com",
        name: "Ops",
        createdAt: new Date().toISOString(),
      });
      await ctx.db.insert("mutavStaff", {
        userId,
        role: "admin",
        createdAt: new Date().toISOString(),
      });
    });

    const report = await t.query(internal.launch.useCases.readiness, {});

    expect(report.blockers.map((b) => b.code)).not.toContain("DEPLOYMENT_NOT_LOCKED");
    expect(report.blockers.map((b) => b.code)).not.toContain("NO_STAFF_ADMIN");
    expect(report.blockers.map((b) => b.code)).not.toContain("NO_DEFAULT_PRODUCT");
  });
});
