// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const SIGNUP_EMAIL = "joao.silva@example.com";

describe("join — what the scheduled argument record retains", () => {
  // Convex persists a scheduled call's arguments on its `_scheduled_functions`
  // row, and the same arguments reach the deployment function log. That log is
  // US-hosted and readable from the dashboard, outside every access control the
  // schema has, so this is the assertion the whole change exists for.
  test("schedules both deliveries by row id, with no address in the persisted args", async () => {
    const t = convexTest(schema);

    const result = await t.mutation(api.waitlist.useCases.join, {
      email: SIGNUP_EMAIL,
      audience: "imobiliaria",
    });
    expect(result.success).toBe(true);

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

    expect(scheduled.map((job) => job.name).sort()).toEqual([
      "waitlist/actions:addToResendAudience",
      "waitlist/actions:sendWelcomeEmail",
    ]);

    const waitlistId = await t.run(async (ctx) => {
      const row = await ctx.db.query("waitlist").first();
      return row === null ? null : row._id;
    });
    for (const job of scheduled) {
      expect(job.args).toEqual([{ waitlistId }]);
    }

    expect(JSON.stringify(scheduled)).not.toContain(SIGNUP_EMAIL);
    expect(JSON.stringify(scheduled)).not.toContain("@");
  });

  test("still records the signup itself — the address moves, it is not dropped", async () => {
    const t = convexTest(schema);

    await t.mutation(api.waitlist.useCases.join, {
      email: SIGNUP_EMAIL,
      audience: "investidor",
    });

    const rows = await t.run((ctx) => ctx.db.query("waitlist").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(SIGNUP_EMAIL);
    expect(rows[0].audience).toBe("investidor");
  });
});

describe("getForDeliveryInternal", () => {
  test("resolves a row id to the address and audience a send needs", async () => {
    const t = convexTest(schema);
    const waitlistId = await t.run((ctx) =>
      ctx.db.insert("waitlist", {
        email: SIGNUP_EMAIL,
        audience: "imobiliaria",
        ts: 1_700_000_000_000,
        ip: "203.0.113.7",
        ua: "Mozilla/5.0",
        referer: "https://mutav.finance/imobiliaria",
      }),
    );

    const delivery = await t.query(internal.waitlist.useCases.getForDeliveryInternal, {
      waitlistId,
    });

    // Exactly two fields: the audit columns are personal data the send has no
    // use for, so they must not cross the boundary.
    expect(delivery).toEqual({ email: SIGNUP_EMAIL, audience: "imobiliaria" });
  });

  test("returns null when the row was erased between scheduling and execution", async () => {
    const t = convexTest(schema);
    const waitlistId = await t.run((ctx) =>
      ctx.db.insert("waitlist", {
        email: SIGNUP_EMAIL,
        audience: "imobiliaria",
        ts: 1_700_000_000_000,
      }),
    );
    await t.run((ctx) => ctx.db.delete(waitlistId));

    const delivery = await t.query(internal.waitlist.useCases.getForDeliveryInternal, {
      waitlistId,
    });

    expect(delivery).toBeNull();
  });
});
