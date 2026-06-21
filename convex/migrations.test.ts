// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { registerMigrationsComponent } from "./lib/testFixtures";

function setup() {
  const t = convexTest(schema);
  registerMigrationsComponent(t);
  return t;
}

async function seedUser(t: ReturnType<typeof setup>, email: string, isStaff: boolean | undefined) {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${email}`,
      name: "Test User",
      email,
      createdAt: new Date().toISOString(),
      ...(isStaff === undefined ? {} : { isStaff }),
    }),
  );
}

async function runClearIsStaff(t: ReturnType<typeof setup>) {
  await t.mutation(internal.migrations.clearUsersIsStaff, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("clearUsersIsStaff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("removes the field from a user that has isStaff: true", async () => {
    const t = setup();
    const id = await seedUser(t, "staff-true@mutav.test", true);

    await runClearIsStaff(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isStaff).toBeUndefined();
  });

  test("removes the field from a user that has isStaff: false", async () => {
    const t = setup();
    const id = await seedUser(t, "staff-false@mutav.test", false);

    await runClearIsStaff(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isStaff).toBeUndefined();
  });

  test("leaves a user that never had isStaff untouched", async () => {
    const t = setup();
    const id = await seedUser(t, "clean@mutav.test", undefined);

    await runClearIsStaff(t);

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.isStaff).toBeUndefined();
    expect(after?.email).toBe("clean@mutav.test");
  });

  test("clears a mixed batch and is idempotent on re-run", async () => {
    const t = setup();
    const setId = await seedUser(t, "set@mutav.test", true);
    const cleanId = await seedUser(t, "already-clean@mutav.test", undefined);

    await runClearIsStaff(t);
    await runClearIsStaff(t);

    const set = await t.run((ctx) => ctx.db.get(setId));
    const clean = await t.run((ctx) => ctx.db.get(cleanId));
    expect(set?.isStaff).toBeUndefined();
    expect(clean?.isStaff).toBeUndefined();
  });
});
