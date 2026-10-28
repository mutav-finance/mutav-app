// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

const AGENCY_FIXTURE = { name: "Imobiliária Teste", createdAt: "2026-01-01T00:00:00.000Z" };

describe("getMe", () => {
  test("returns null when no JWT is present (signed-out reader)", async () => {
    const t = convexTest(schema);
    const result = await t.query(api.users.useCases.getMe, {});
    expect(result).toBeNull();
  });

  test("returns the row matching JWT subject when authenticated", async () => {
    const t = convexTest(schema);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "alice",
        subject: "auth0|alice",
        name: "Alice",
        email: "alice@test.br",
        createdAt: new Date().toISOString(),
      }),
    );

    const asAlice = t.withIdentity({
      subject: "auth0|alice",
      email: "alice@test.br",
      name: "Alice",
    });
    const result = await asAlice.query(api.users.useCases.getMe, {});
    expect(result?._id).toBe(userId);
  });

  test("returns null when JWT subject doesn't match any user (pre-provisioning)", async () => {
    const t = convexTest(schema);
    const asGhost = t.withIdentity({
      subject: "auth0|ghost",
      email: "ghost@test.br",
      name: "Ghost",
    });
    const result = await asGhost.query(api.users.useCases.getMe, {});
    expect(result).toBeNull();
  });
});

describe("getOrCreateByIdentity", () => {
  test("creates a new user row on first call with a fresh subject", async () => {
    const t = convexTest(schema);
    const asAlice = t.withIdentity({
      subject: "auth0|alice",
      email: "alice@test.br",
      emailVerified: true,
      name: "Alice",
    });

    const result = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    if (!result.success) throw new Error(`expected success, got ${result.error.code}`);
    expect(result.data.created).toBe(true);
    expect(result.data.linked).toBe(false);

    const user = await t.run((ctx) => ctx.db.get(result.data.userId));
    expect(user?.subject).toBe("auth0|alice");
    expect(user?.email).toBe("alice@test.br");
    expect(user?.name).toBe("Alice");
    expect(user?.publicId).toMatch(/^user-[0-9a-f]{16}$/);
  });

  test("is idempotent — same subject returns the same row without creating", async () => {
    const t = convexTest(schema);
    const asAlice = t.withIdentity({
      subject: "auth0|alice",
      email: "alice@test.br",
      emailVerified: true,
      name: "Alice",
    });

    const first = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    if (!first.success) throw new Error(`expected success, got ${first.error.code}`);
    expect(first.data.created).toBe(true);

    const second = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    expect(second).toEqual({
      success: true,
      data: { userId: first.data.userId, created: false, linked: false },
      message: "User already provisioned",
    });

    const all = await t.run((ctx) => ctx.db.query("users").collect());
    expect(all).toHaveLength(1);
  });

  test("links a subjectless row when the email is verified", async () => {
    const t = convexTest(schema);
    const legacyId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "legacy-alice",
        name: "Alice Legacy",
        email: "alice@test.br",
        createdAt: new Date().toISOString(),
      }),
    );

    const asAlice = t.withIdentity({
      subject: "auth0|alice",
      email: "alice@test.br",
      emailVerified: true,
      name: "Alice",
    });
    const result = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});

    expect(result).toEqual({
      success: true,
      data: { userId: legacyId, created: false, linked: true },
      message: "Existing user linked to identity",
    });

    const linked = await t.run((ctx) => ctx.db.get(legacyId));
    expect(linked?.subject).toBe("auth0|alice");
    // Preserves the legacy display name + publicId — only `subject` is patched.
    expect(linked?.name).toBe("Alice Legacy");
    expect(linked?.publicId).toBe("legacy-alice");
  });

  test.each([
    { label: "emailVerified false", emailVerified: false },
    { label: "emailVerified absent", emailVerified: undefined },
  ])(
    "refuses to link a subjectless row when the email is unverified ($label)",
    async ({ emailVerified }) => {
      const t = convexTest(schema);
      const seededId = await t.run((ctx) =>
        ctx.db.insert("users", {
          publicId: "seeded-alice",
          name: "Alice Seeded",
          email: "alice@test.br",
          createdAt: new Date().toISOString(),
        }),
      );

      const asAttacker = t.withIdentity({
        subject: "auth0|attacker",
        email: "alice@test.br",
        emailVerified,
        name: "Attacker",
      });
      const result = await asAttacker.mutation(api.users.useCases.getOrCreateByIdentity, {});

      expect(result).toEqual({
        success: false,
        error: { code: "EMAIL_NOT_VERIFIED" },
        message: "Email must be verified before linking to an existing user",
      });

      const all = await t.run((ctx) => ctx.db.query("users").collect());
      expect(all).toHaveLength(1);
      expect(all[0]?._id).toBe(seededId);
      expect(all[0]?.subject).toBeUndefined();
    },
  );

  test("refuses a different subject whose email is already bound — no duplicate row", async () => {
    const t = convexTest(schema);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "alice",
        subject: "auth0|alice",
        name: "Alice",
        email: "alice@test.br",
        createdAt: new Date().toISOString(),
      }),
    );

    const asOther = t.withIdentity({
      subject: "google-oauth2|alice",
      email: "alice@test.br",
      emailVerified: true,
      name: "Alice via Google",
    });
    const result = await asOther.mutation(api.users.useCases.getOrCreateByIdentity, {});

    expect(result).toEqual({
      success: false,
      error: { code: "EMAIL_BOUND_TO_OTHER_IDENTITY" },
      message: "Email is already bound to another identity",
    });

    const all = await t.run((ctx) => ctx.db.query("users").collect());
    expect(all).toHaveLength(1);
    expect(all[0]?.subject).toBe("auth0|alice");
  });

  test("throws UnauthenticatedError when no JWT is present", async () => {
    const t = convexTest(schema);
    await expect(t.mutation(api.users.useCases.getOrCreateByIdentity, {})).rejects.toThrow(/JWT/);
  });

  test("refuses to provision when the JWT has no email claim", async () => {
    const t = convexTest(schema);
    const asAnon = t.withIdentity({ subject: "auth0|no-email" });
    await expect(asAnon.mutation(api.users.useCases.getOrCreateByIdentity, {})).rejects.toThrow(
      /email/,
    );
  });
});

describe("clearSubjectsForTenantCut", () => {
  test("clears every subject, keeps other fields and tables, and a verified login re-links", async () => {
    const t = convexTest(schema);
    const createdAt = "2026-01-01T00:00:00.000Z";
    const { aliceId, bobId, legacyId, agencyId, membershipId } = await t.run(async (ctx) => {
      const aliceId = await ctx.db.insert("users", {
        publicId: "alice",
        subject: "auth0|old-alice",
        name: "Alice",
        email: "alice@test.br",
        createdAt,
      });
      const bobId = await ctx.db.insert("users", {
        publicId: "bob",
        subject: "auth0|old-bob",
        name: "Bob",
        email: "bob@test.br",
        createdAt,
      });
      const legacyId = await ctx.db.insert("users", {
        publicId: "legacy",
        name: "Legacy",
        email: "legacy@test.br",
        createdAt,
      });
      const agencyId = await ctx.db.insert("agencies", AGENCY_FIXTURE);
      const membershipId = await ctx.db.insert("memberships", {
        userId: aliceId,
        agencyId,
        role: "owner",
        joinedAt: createdAt,
      });
      return { aliceId, bobId, legacyId, agencyId, membershipId };
    });
    const before = await t.run(async (ctx) => ({
      agency: await ctx.db.get(agencyId),
      membership: await ctx.db.get(membershipId),
    }));

    const counts = await t.mutation(internal.users.useCases.clearSubjectsForTenantCut, {});
    expect(counts).toEqual({ scanned: 3, cleared: 2, isDone: true });

    const users = await t.run((ctx) => ctx.db.query("users").collect());
    expect(users).toHaveLength(3);
    for (const user of users) expect(user.subject).toBeUndefined();
    const alice = users.find((u) => u._id === aliceId);
    expect(alice).toMatchObject({
      publicId: "alice",
      name: "Alice",
      email: "alice@test.br",
      createdAt,
    });
    expect(users.find((u) => u._id === bobId)?.email).toBe("bob@test.br");
    expect(users.find((u) => u._id === legacyId)?.email).toBe("legacy@test.br");

    const after = await t.run(async (ctx) => ({
      agency: await ctx.db.get(agencyId),
      membership: await ctx.db.get(membershipId),
    }));
    expect(after).toEqual(before);

    const asNewTenantAlice = t.withIdentity({
      subject: "auth0|new-alice",
      email: "alice@test.br",
      emailVerified: true,
      name: "Alice",
    });
    const result = await asNewTenantAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    expect(result).toEqual({
      success: true,
      data: { userId: aliceId, created: false, linked: true },
      message: "Existing user linked to identity",
    });
    const relinked = await t.run((ctx) => ctx.db.get(aliceId));
    expect(relinked?.subject).toBe("auth0|new-alice");
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toHaveLength(3);
  });
});
