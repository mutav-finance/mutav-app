// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import schema from "../schema";

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
      name: "Alice",
    });

    const result = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    expect(result.created).toBe(true);
    expect(result.linked).toBe(false);

    const user = await t.run((ctx) => ctx.db.get(result.userId));
    expect(user?.subject).toBe("auth0|alice");
    expect(user?.email).toBe("alice@test.br");
    expect(user?.name).toBe("Alice");
    expect(user?.publicId).toMatch(/^user-[0-9a-f]{16}$/);
  });

  test("is idempotent — second call returns the same row without creating", async () => {
    const t = convexTest(schema);
    const asAlice = t.withIdentity({
      subject: "auth0|alice",
      email: "alice@test.br",
      name: "Alice",
    });

    const first = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    expect(first.created).toBe(true);

    const second = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    expect(second.created).toBe(false);
    expect(second.linked).toBe(false);
    expect(second.userId).toBe(first.userId);

    const all = await t.run((ctx) => ctx.db.query("users").collect());
    expect(all).toHaveLength(1);
  });

  test("links by email when an existing row has no subject yet (legacy pre-Auth0 row)", async () => {
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
      name: "Alice",
    });
    const result = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});

    expect(result.created).toBe(false);
    expect(result.linked).toBe(true);
    expect(result.userId).toBe(legacyId);

    const linked = await t.run((ctx) => ctx.db.get(legacyId));
    expect(linked?.subject).toBe("auth0|alice");
    // Preserves the legacy display name + publicId — only `subject` is patched.
    expect(linked?.name).toBe("Alice Legacy");
    expect(linked?.publicId).toBe("legacy-alice");
  });

  test("does NOT overwrite an existing subject — different subject + same email creates new row", async () => {
    const t = convexTest(schema);
    const aliceId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "alice",
        subject: "auth0|alice",
        name: "Alice",
        email: "alice@test.br",
        createdAt: new Date().toISOString(),
      }),
    );

    // Different subject (e.g. user re-signed up with a different identity
    // provider) but same email. Linking would silently merge accounts —
    // we prefer to create a separate row and let an admin disambiguate.
    const asBob = t.withIdentity({
      subject: "google-oauth2|bob",
      email: "alice@test.br",
      name: "Bob",
    });
    const result = await asBob.mutation(api.users.useCases.getOrCreateByIdentity, {});

    // No subject match, and the by-email lookup finds Alice's row but
    // it already has a (different) `subject` set — the `!byEmail.subject`
    // guard fails, so we create a fresh row rather than silently merging.
    expect(result.created).toBe(true);
    expect(result.linked).toBe(false);
    expect(result.userId).not.toBe(aliceId);

    const all = await t.run((ctx) => ctx.db.query("users").collect());
    expect(all).toHaveLength(2);
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
