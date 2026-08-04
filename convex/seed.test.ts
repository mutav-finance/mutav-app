// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { internal } from "./_generated/api";
import type { AgencyId } from "./agencies/domain";
import { registerContractAggregateComponents } from "./lib/testFixtures";
import schema from "./schema";

// `seedReset` creates every tenant through `getOrCreateTenant`, which hashes
// the tax id via the PII crypto helpers. Without these keys the first
// `insertSeedContract` call throws.
beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test-only env fixture
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test-only env fixture
});

function setup() {
  const t = convexTest(schema);
  // seedReset writes contract aggregates; the components must be registered
  // or the aggregate writes throw.
  registerContractAggregateComponents(t);
  return t;
}

async function agencyIdByName(t: ReturnType<typeof setup>, name: string): Promise<AgencyId> {
  const agency = await t.run(async (ctx) => {
    const rows = await ctx.db.query("agencies").collect();
    return rows.find((a) => a.name === name) ?? null;
  });
  if (!agency) throw new Error(`agency "${name}" not found after seedReset`);
  return agency._id;
}

async function contractCountFor(t: ReturnType<typeof setup>, agencyId: AgencyId): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("contracts")
      .withIndex("by_agency_status", (q) => q.eq("agencyId", agencyId))
      .collect();
    return rows.length;
  });
}

async function tenantCount(t: ReturnType<typeof setup>): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db.query("tenants").collect();
    return rows.length;
  });
}

describe("seedReset", () => {
  test("agencyowner's agency (Imobiliária Aprovada) has contracts — the partial-seed regression guard", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const aprovadaId = await agencyIdByName(t, "Imobiliária Aprovada");
    const count = await contractCountFor(t, aprovadaId);

    // The exact bug this test guards: seeding the demo agencies but skipping
    // populateAprovadaBook leaves this at 0, so agencyowner logs in to an
    // empty dashboard. Any partial-seed path reintroducing that must fail here.
    expect(count).toBeGreaterThan(0);
  });

  test("seeds the three demo agencies each with their contracts", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const demoAgencies = ["Imobiliária Paulista", "Imobiliária Atlântica", "Horizonte Imóveis"];
    for (const name of demoAgencies) {
      const id = await agencyIdByName(t, name);
      const count = await contractCountFor(t, id);
      expect(count, `${name} should have contracts`).toBeGreaterThan(0);
    }

    // Sanity: the fictional dataset is 30 contracts (15 + 12 + 3) across the
    // three demo agencies. Guards against the demo book silently shrinking.
    const [paulista, atlantica, horizonte] = await Promise.all(
      demoAgencies.map(async (name) => contractCountFor(t, await agencyIdByName(t, name))),
    );
    expect(paulista + atlantica + horizonte).toBe(30);
  });

  test("registers tenants and links every seeded contract by tenantId", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    // The registry must be populated — seedFictional + populateAprovadaBook
    // run every contract's tenant block through getOrCreateTenant.
    expect(await tenantCount(t)).toBeGreaterThan(0);

    // Registry-only: every seeded contract carries the registry link
    // (tenantId + tenantApproval) and no embedded tenant — the narrowed
    // schema dropped the embedded fields, so the link is the only tenant ref.
    const aprovadaId = await agencyIdByName(t, "Imobiliária Aprovada");
    const linked = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("contracts")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", aprovadaId))
        .collect();
      const resolvedTenants = await Promise.all(rows.map((r) => ctx.db.get(r.tenantId)));
      return {
        total: rows.length,
        withResolvableTenant: resolvedTenants.filter((tenant) => tenant !== null).length,
      };
    });
    expect(linked.total).toBeGreaterThan(0);
    // The tenantId link must resolve to a real registry row for every contract.
    expect(linked.withResolvableTenant).toBe(linked.total);
  });

  test("gives every contract its own tenant submission, so the read paths can fail closed", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    // The read paths no longer fall back to the shared registry row — serving
    // it would show one agency the identity another agency submitted for the
    // same person. That fail-closed choice is only safe while every contract
    // carries a submission of its own, which is what this asserts.
    const missing = await t.run(async (ctx) => {
      const contracts = await ctx.db.query("contracts").collect();
      const withoutSnapshot: string[] = [];
      for (const contract of contracts) {
        const history = await ctx.db
          .query("contractHistory")
          .withIndex("by_agency_contract", (q) =>
            q.eq("agencyId", contract.agencyId).eq("contractPublicId", contract.publicId),
          )
          .collect();
        if (!history.some((entry) => entry.tenantSnapshot !== undefined)) {
          withoutSnapshot.push(contract.publicId);
        }
      }
      return { total: contracts.length, withoutSnapshot };
    });

    expect(missing.total).toBeGreaterThan(0);
    expect(missing.withoutSnapshot).toEqual([]);
  });

  test("the snapshot is found by content, not by sort order", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    // Seed timestamps are offset-form (`-03:00`), which sorts BEFORE Z-form
    // while denoting a later instant. A reader that took the earliest row
    // would miss the snapshot the moment any Z-form row is appended, and fall
    // through to the shared registry row.
    const probe = await t.run(async (ctx) => {
      const contract = await ctx.db.query("contracts").first();
      if (!contract) throw new Error("seed produced no contracts");
      await ctx.db.insert("contractHistory", {
        agencyId: contract.agencyId,
        contractPublicId: contract.publicId,
        at: "2020-01-01T00:00:00.000Z",
        username: "probe",
        message: "sorts first, carries no snapshot",
      });
      const history = await ctx.db
        .query("contractHistory")
        .withIndex("by_agency_contract", (q) =>
          q.eq("agencyId", contract.agencyId).eq("contractPublicId", contract.publicId),
        )
        .collect();
      return {
        earliestHasSnapshot: history[0]?.tenantSnapshot !== undefined,
        someRowHasSnapshot: history.some((entry) => entry.tenantSnapshot !== undefined),
      };
    });

    expect(probe.earliestHasSnapshot).toBe(false);
    expect(probe.someRowHasSnapshot).toBe(true);
  });

  test("seeds all four personas with the correct staff / agency state", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const personas = await t.run(async (ctx) => {
      const users = await ctx.db.query("users").collect();
      const wanted = [
        "systemadmin@mutav.finance",
        "agencyowner@mutav.finance",
        "pendinguser@mutav.finance",
        "newuser@mutav.finance",
      ];
      return Promise.all(
        wanted.map(async (email) => {
          const user = users.find((u) => u.email === email) ?? null;
          if (!user) return { email, user: null };
          const staffRoles = await ctx.db
            .query("mutavStaff")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .collect();
          const memberships = await ctx.db
            .query("memberships")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .collect();
          const agencyStates = await Promise.all(
            memberships.map(async (m) => {
              const agency = await ctx.db.get(m.agencyId);
              return agency?.onboardingState ?? null;
            }),
          );
          return {
            email,
            subject: user.subject ?? null,
            staffRoleCount: staffRoles.length,
            agencyStates,
          };
        }),
      );
    });

    const byEmail = new Map(personas.map((p) => [p.email, p]));

    const systemadmin = byEmail.get("systemadmin@mutav.finance");
    expect(systemadmin?.subject).toBe("auth0|6a150df6a100fbf318f393c0");
    // systemadmin is the only staff persona (one mutavStaff "admin" row).
    expect(systemadmin?.staffRoleCount).toBe(1);
    expect(systemadmin?.agencyStates).toEqual([]);

    const agencyowner = byEmail.get("agencyowner@mutav.finance");
    expect(agencyowner?.subject).toBe("auth0|6a150df7def07da7a5297480");
    expect(agencyowner?.staffRoleCount).toBe(0);
    expect(agencyowner?.agencyStates).toContain("active");

    const pendinguser = byEmail.get("pendinguser@mutav.finance");
    expect(pendinguser?.subject).toBe("auth0|6a150df8d2051b0ac866a3b6");
    expect(pendinguser?.staffRoleCount).toBe(0);
    expect(pendinguser?.agencyStates).toContain("under_review");

    const newuser = byEmail.get("newuser@mutav.finance");
    expect(newuser?.subject).toBe("auth0|6a150df9a100fbf318f393c3");
    expect(newuser?.staffRoleCount).toBe(0);
    expect(newuser?.agencyStates).toEqual([]);
  });

  test("preserves the application a retained credit signal is attributed to", async () => {
    const t = setup();
    // A bureau consultation and the art. 15 declaration that authorised it.
    // `creditAnalysisSignals` is never wiped, so wiping the declaration would
    // leave the retained signal pointing at a row that no longer exists.
    const signalId = await t.run(async (ctx) => {
      const agencyId = await ctx.db.insert("agencies", {
        name: "Imobiliária Pré-Reseed",
        cnpj: "11222333000181",
        onboardingState: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      const userId = await ctx.db.insert("users", {
        publicId: "USR-PRERESEED",
        email: "broker@example.com",
        name: "Broker",
        createdAt: "2026-08-01T00:00:00.000Z",
      });
      const applicationId = await ctx.db.insert("contractApplications", {
        agencyId,
        subjectHash: "hash-of-a-subject",
        entityType: "pf",
        propertyKind: "residencial",
        cep: "01310100",
        rentCents: 250_000,
        openedBy: userId,
        openedAt: 1_700_000_000_000,
      });
      return ctx.db.insert("creditAnalysisSignals", {
        agencyId,
        subjectType: "tenant",
        subjectHash: "hash-of-a-subject",
        capability: "credit_score",
        provider: "mock",
        status: "ok",
        normalized: { score: 700, scale: 1000 },
        correlationId: "corr-1",
        windowKey: "2026-08-02",
        pulledAt: 1_700_000_000_000,
        applicationId,
        legalBasis: "art7_x",
      });
    });

    await t.mutation(internal.seed.seedReset, {});

    const attribution = await t.run(async (ctx) => {
      const signal = await ctx.db.get(signalId);
      if (!signal?.applicationId) return null;
      return ctx.db.get(signal.applicationId);
    });
    expect(attribution).not.toBeNull();
    // And the reseed still produced the app data (wipe ran).
    expect(await tenantCount(t)).toBeGreaterThan(0);
  });

  test("preserves the waitlist (marketing leads) — the wipe is app-demo-only", async () => {
    const t = setup();
    // A real marketing lead present before a reseed must survive it.
    await t.run(async (ctx) => {
      await ctx.db.insert("waitlist", {
        email: "lead@example.com",
        audience: "imobiliaria",
        ts: 1_700_000_000_000,
      });
    });

    await t.mutation(internal.seed.seedReset, {});

    const surviving = await t.run(async (ctx) => ctx.db.query("waitlist").collect());
    expect(surviving.map((r) => r.email)).toContain("lead@example.com");
    // And the reseed still produced the app data (wipe ran).
    expect(await tenantCount(t)).toBeGreaterThan(0);
  });
});
