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
});
