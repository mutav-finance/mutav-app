// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { AgencyId } from "./agencies/domain";
import {
  DELINQUENCY_STATUS,
  NOTICE_CANCELLATION_REASON,
  NOTICE_RESOLUTION_KIND,
} from "./delinquencies/domain";
import {
  countByStatePlatform,
  countInsured,
  sumInsuredExposure,
  sumVerifiedDefaultExposure,
} from "./guarantees/aggregate";
import { CLOSE_REASON, GUARANTEE_STATE, GUARANTEE_STATES } from "./guarantees/domain";
import { isValidCapacity } from "./guarantees/transitions";
import { DEFAULT_PRICING_TABLE } from "./guarantees/pricing";
import { isOverdue } from "./invoices/domain";
import { registerGuaranteeAggregateComponents } from "./lib/testFixtures";
import { isEffective } from "./products/domain";
import schema from "./schema";

// Full ISO timestamp (date + time); date-only strings misbucket against the
// `toISOString()` bounds the activity series compares them with.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// `seedReset` creates every tenant through `getOrCreateTenant`, which hashes
// the tax id via the PII crypto helpers. Without these keys the first
// `insertSeedLeaseAndGuarantee` call throws.
beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64"); // hook-ok: test-only env fixture
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64"); // hook-ok: test-only env fixture
});

// The live half of the dataset is dated back from the reseed, so every test
// runs on one pinned clock and date expectations stay literal. Only `Date` is
// faked; convex-test's own timers keep running.
const SEED_NOW = "2026-09-28T15:00:00.000Z";

// Worst-case exposure over the in-force book and its verified-default slice,
// in BRL centavos: available rent-coverage + exit-cost cap per guarantee.
const SUM_INSURED_CENTS = 689_806_900;
const VERIFIED_DEFAULT_EXPOSURE_CENTS = 72_078_600;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SEED_NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const t = convexTest(schema);
  // seedReset writes guarantee aggregates; the components must be registered
  // or the aggregate writes throw.
  registerGuaranteeAggregateComponents(t);
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

async function guaranteeCountFor(t: ReturnType<typeof setup>, agencyId: AgencyId): Promise<number> {
  return t.run(async (ctx) => {
    const rows = await ctx.db
      .query("guarantees")
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
  test("agencyowner's agency (Imobiliária Aprovada) has guarantees — the partial-seed regression guard", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const aprovadaId = await agencyIdByName(t, "Imobiliária Aprovada");
    const count = await guaranteeCountFor(t, aprovadaId);

    // The exact bug this test guards: seeding the demo agencies but skipping
    // populateAprovadaBook leaves this at 0, so agencyowner logs in to an
    // empty dashboard. Any partial-seed path reintroducing that must fail here.
    expect(count).toBeGreaterThan(0);
  });

  test("seeds the three demo agencies each with their guarantees", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const demoAgencies = ["Imobiliária Paulista", "Imobiliária Atlântica", "Horizonte Imóveis"];
    for (const name of demoAgencies) {
      const id = await agencyIdByName(t, name);
      const count = await guaranteeCountFor(t, id);
      expect(count, `${name} should have guarantees`).toBeGreaterThan(0);
    }

    // Sanity: the fictional dataset is 58 guarantees — 15 + 12 + 3 original
    // lives, one default each for Paulista and Atlântica, and 13 + 13
    // performing filler leases. Guards against the demo book silently shrinking.
    const [paulista, atlantica, horizonte] = await Promise.all(
      demoAgencies.map(async (name) => guaranteeCountFor(t, await agencyIdByName(t, name))),
    );
    expect({ paulista, atlantica, horizonte }).toEqual({
      paulista: 29,
      atlantica: 26,
      horizonte: 3,
    });
  });

  test("maps the legacy PT statuses onto the 7-state machine with reasoned closures", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const byState = await t.run(async (ctx) => {
      const rows = await ctx.db.query("guarantees").collect();
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
      const closed = rows.filter((row) => row.status === GUARANTEE_STATE.CLOSED);
      return {
        counts,
        closedReasons: closed.map((row) => row.closure?.reason).sort(),
        closedWithoutClosure: closed.filter((row) => row.closure === undefined).length,
        nonClosedWithClosure: rows.filter(
          (row) => row.status !== GUARANTEE_STATE.CLOSED && row.closure !== undefined,
        ).length,
      };
    });

    // active: 21 fictional + 26 filler + Aprovada's performing and renewed
    // lives. default_verified: Aprovada ×2 + Paulista. cover_committed:
    // Aprovada ×2 + Atlântica. in_eviction: Horizonte + Aprovada. drafted:
    // 5 pendente + 1 Aprovada. closed: 2 encerrado + Aprovada's first term →
    // end_of_lease, 1 cancelado → canceled_pre_activation, and Aprovada's
    // reversed cover → dispute_reversal.
    expect(byState.counts).toEqual({
      active: 49,
      in_arrears: 1,
      default_verified: 3,
      cover_committed: 3,
      in_eviction: 2,
      drafted: 6,
      closed: 5,
    });
    expect(byState.closedReasons).toEqual([
      "canceled_pre_activation",
      "dispute_reversal",
      "end_of_lease",
      "end_of_lease",
      "end_of_lease",
    ]);
    expect(byState.closedWithoutClosure).toBe(0);
    expect(byState.nonClosedWithClosure).toBe(0);
  });

  test("every non-drafted guarantee carries transition history that replays to its current status", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const rows = await t.run(async (ctx) => {
      const guarantees = await ctx.db.query("guarantees").collect();
      const history = await ctx.db.query("guaranteeHistory").collect();
      return guarantees.map((guarantee) => ({
        publicId: guarantee.publicId,
        status: guarantee.status,
        transitions: history
          .filter(
            (row) =>
              row.agencyId === guarantee.agencyId && row.guaranteePublicId === guarantee.publicId,
          )
          .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
          .flatMap((row) => (row.transition ? [{ at: row.at, ...row.transition }] : [])),
      }));
    });

    const nonDraftedWithoutHistory = rows
      .filter((row) => row.status !== GUARANTEE_STATE.DRAFTED && row.transitions.length === 0)
      .map((row) => row.publicId);
    expect(nonDraftedWithoutHistory).toEqual([]);

    const draftedWithHistory = rows
      .filter((row) => row.status === GUARANTEE_STATE.DRAFTED && row.transitions.length > 0)
      .map((row) => row.publicId);
    expect(draftedWithHistory).toEqual([]);

    // Replay: every path starts at `drafted`, each hop leaves where the last
    // one landed, and the last hop lands on the row's stored status.
    const replayed = rows
      .filter((row) => row.transitions.length > 0)
      .map((row) => {
        let state: string = GUARANTEE_STATE.DRAFTED;
        const broken: string[] = [];
        for (const transition of row.transitions) {
          if (transition.from !== state) broken.push(`${state} != ${transition.from}`);
          state = transition.to;
        }
        return { publicId: row.publicId, state, broken };
      });
    expect(replayed.filter((row) => row.broken.length > 0)).toEqual([]);
    expect(
      replayed
        .filter((row) => {
          const guarantee = rows.find((candidate) => candidate.publicId === row.publicId);
          return guarantee?.status !== row.state;
        })
        .map((row) => row.publicId),
    ).toEqual([]);

    // The whole point of the structured rows: every state the machine can
    // reach is actually reached somewhere in the demo book, so the state
    // timeline is a real path rather than one flat step at today's status.
    const reached = [...new Set(rows.flatMap((row) => row.transitions.map((x) => x.to)))].sort();
    expect(reached).toEqual([
      "active",
      "closed",
      "cover_committed",
      "default_verified",
      "in_arrears",
      "in_eviction",
    ]);

    // Spread over the trailing year, not stacked on one seed date.
    const months = new Set(rows.flatMap((row) => row.transitions.map((x) => x.at.slice(0, 7))));
    expect(months.size).toBeGreaterThanOrEqual(12);
  });

  test("the guarantee in eviction carries the full arrears → verified → cover → eviction path", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const path = await t.run(async (ctx) => {
      const guarantee = await ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", "1000029"))
        .unique();
      if (guarantee?.status !== GUARANTEE_STATE.IN_EVICTION) {
        throw new Error("Horizonte's 1000029 is not seeded in eviction");
      }
      const history = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) =>
          q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", guarantee.publicId),
        )
        .collect();
      return history
        .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
        .flatMap((row) =>
          row.transition
            ? [`${row.at.slice(0, 10)} ${row.transition.from}->${row.transition.to}`]
            : [],
        );
    });

    // The eviction filing has no timestamp anywhere in the schema; the seed
    // derives it 15 days after the cover, the interval the notice's own
    // resolution note describes. The notice book is dated back from the pinned
    // reseed clock (2026-09-28): opened 47 days ago, verified 36, covered 28.
    expect(path).toEqual([
      "2026-02-05 drafted->active",
      "2026-08-12 active->in_arrears",
      "2026-08-23 in_arrears->default_verified",
      "2026-08-31 default_verified->cover_committed",
      "2026-09-15 cover_committed->in_eviction",
    ]);
  });

  test("seeds exactly one default product carrying today's pricing constants", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const products = await t.run(async (ctx) => {
      const all = await ctx.db.query("products").collect();
      const defaults = await ctx.db
        .query("products")
        .withIndex("by_enabled_isDefault", (q) => q.eq("enabled", true).eq("isDefault", true))
        .collect();
      return { all, defaults };
    });

    expect(products.all).toHaveLength(1);
    expect(products.defaults).toHaveLength(1);
    const product = products.defaults[0];
    expect(product.slug).toBe("mutav-fianca");
    expect(product.terms).toEqual(DEFAULT_PRICING_TABLE);
    expect(product.terms).toEqual({
      tierRate: { bom: 0.09, regular: 0.12, ruim: 0.15 },
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      activationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaPremiumCents: 1_280,
      prestamistaCommissionRate: 0.25,
    });
  });

  test("every guarantee references the default product and snapshots its terms from it", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const probe = await t.run(async (ctx) => {
      const product = await ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", "mutav-fianca"))
        .unique();
      if (!product) throw new Error("default product missing");
      const rows = await ctx.db.query("guarantees").collect();
      const offProduct = rows.filter(
        (row) => row.productId !== product._id || row.terms.productSlug !== product.slug,
      ).length;
      // Sampled guarantee: pid(1), rent R$ 3.200,00, score 750 → tier regular.
      const sample = await ctx.db
        .query("guarantees")
        .withIndex("by_publicId", (q) => q.eq("publicId", "1000001"))
        .unique();
      if (!sample) throw new Error("guarantee 1000001 missing");
      const lease = await ctx.db.get(sample.leaseId);
      return { offProduct, sample, leaseRentCents: lease?.rent.rentCents ?? null };
    });

    expect(probe.offProduct).toBe(0);
    expect(probe.sample.underwriting).toEqual({ score: 750, tier: "regular" });
    expect(probe.leaseRentCents).toBe(320_000);
    // Literal expectations: the product's parameters applied to a R$ 3.200,00
    // rent at the regular tier on the basic plan — no prestamista premium.
    expect(probe.sample.terms).toEqual({
      productSlug: "mutav-fianca",
      plan: "basic",
      rentCents: 320_000,
      feeCents: 38_400,
      taxaFeeCents: 38_400,
      prestamistaFeeCents: 0,
      oneTimeActivationFeeCents: 15_000,
      commissionRate: 0.015,
      prestamistaCommissionRate: 0.25,
      coverageCeilingMultiplier: 30,
      exitCostMultiplier: 6,
      coverageCeilingCents: 9_600_000,
      exitCostCapCents: 1_920_000,
      // The snapshot is dated at activation, not at the tenant's term approval.
      // Seed timestamps are normalized to UTC so they compare against the
      // `Z`-form strings the runtime writes.
      appliedAt: "2025-06-03T13:00:00.000Z",
    });
    expect(probe.sample.capacity).toEqual({
      ceilingCents: 9_600_000,
      availableCents: 9_600_000,
      reservedCents: 0,
    });
  });

  test("the default product is in effect at every seeded guarantee's appliedAt", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const probe = await t.run(async (ctx) => {
      const product = await ctx.db
        .query("products")
        .withIndex("by_slug", (q) => q.eq("slug", "mutav-fianca"))
        .unique();
      if (!product) throw new Error("default product missing");
      const rows = await ctx.db.query("guarantees").collect();
      return {
        effectiveFrom: product.effectiveFrom,
        pricedBeforeEffect: rows
          .filter((row) => !isEffective(product, row.terms.appliedAt))
          .map((row) => `${row.publicId}@${row.terms.appliedAt}`),
        earliestAppliedAt: rows.map((row) => row.terms.appliedAt).sort()[0],
      };
    });

    expect(probe.effectiveFrom).toBe("2022-01-01T00:00:00.000Z");
    expect(probe.pricedBeforeEffect).toEqual([]);
    // Aprovada's first-term guarantee on the renewed lease is the oldest life
    // in the dataset: activated 900 days before the pinned reseed clock.
    expect(probe.earliestAppliedAt).toBe("2024-04-11T13:00:00.000Z");
  });

  test("every guarantee that has been in force carries a full ISO activatedAt; drafts and pre-activation cancellations carry none", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const audit = await t.run(async (ctx) => {
      const rows = await ctx.db.query("guarantees").collect();
      const neverActivated = (row: (typeof rows)[number]) =>
        row.status === GUARANTEE_STATE.DRAFTED ||
        row.closure?.reason === CLOSE_REASON.CANCELED_PRE_ACTIVATION;
      return {
        total: rows.length,
        activatedWithoutTimestamp: rows
          .filter((row) => !neverActivated(row) && !ISO_TIMESTAMP.test(row.activatedAt ?? ""))
          .map((row) => `${row.publicId}:${row.activatedAt}`),
        neverActivatedWithTimestamp: rows
          .filter((row) => neverActivated(row) && row.activatedAt !== null)
          .map((row) => row.publicId),
        neverActivatedCount: rows.filter(neverActivated).length,
      };
    });

    expect(audit.total).toBe(69);
    expect(audit.activatedWithoutTimestamp).toEqual([]);
    expect(audit.neverActivatedWithTimestamp).toEqual([]);
    // 6 drafts + the one canceled_pre_activation.
    expect(audit.neverActivatedCount).toBe(7);
  });

  test("capacity holds available + reserved = ceiling on every row, and the reserved leg matches the cover applied on the guarantee's resolved notice", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const audit = await t.run(async (ctx) => {
      const rows = await ctx.db.query("guarantees").collect();
      const brokenInvariant = rows
        .filter(
          (row) =>
            !isValidCapacity(row.capacity) ||
            row.capacity.availableCents < 0 ||
            row.capacity.reservedCents < 0,
        )
        .map((row) => row.publicId);
      // `closeAsDisputeReversal` refuses unless the cover its notices applied
      // sums to exactly `reservedCents`, so every committed row must satisfy
      // it for the reversal the demo walks through to be possible at all.
      const appliedCoverSum = async (guaranteeId: (typeof rows)[number]["_id"]) => {
        const notices = await ctx.db
          .query("guaranteeDelinquencyNotices")
          .withIndex("by_guarantee_dueDate", (q) => q.eq("guaranteeId", guaranteeId))
          .collect();
        return notices.reduce(
          (sum, notice) =>
            notice.resolution?.kind === NOTICE_RESOLUTION_KIND.COVER_COMMITTED
              ? sum + (notice.resolution.appliedCoverCents ?? 0)
              : sum,
          0,
        );
      };
      const committed = rows.filter(
        (row) =>
          row.status === GUARANTEE_STATE.COVER_COMMITTED ||
          row.status === GUARANTEE_STATE.IN_EVICTION,
      );
      const committedDetails = await Promise.all(
        committed.map(async (row) => ({
          status: row.status,
          reservedCents: row.capacity.reservedCents,
          appliedCoverCents: await appliedCoverSum(row._id),
        })),
      );
      const reversed = rows.filter((row) => row.closure?.reason === CLOSE_REASON.DISPUTE_REVERSAL);
      const reversedDetails = await Promise.all(
        reversed.map(async (row) => ({
          reservedCents: row.capacity.reservedCents,
          availableIsCeiling: row.capacity.availableCents === row.capacity.ceilingCents,
          appliedCoverCents: await appliedCoverSum(row._id),
        })),
      );
      return {
        brokenInvariant,
        reservedElsewhere: rows
          .filter((row) => row.capacity.reservedCents > 0 && !committed.includes(row))
          .map((row) => row.publicId),
        committedDetails,
        reversedDetails,
      };
    });

    expect(audit.brokenInvariant).toEqual([]);
    expect(audit.reservedElsewhere).toEqual([]);
    expect(audit.committedDetails.map((row) => row.status).sort()).toEqual([
      "cover_committed",
      "cover_committed",
      "cover_committed",
      "in_eviction",
      "in_eviction",
    ]);
    expect(audit.committedDetails.map((row) => row.reservedCents).sort((a, b) => a - b)).toEqual([
      298_700, 355_300, 431_600, 525_000, 682_500,
    ]);
    for (const row of audit.committedDetails) {
      expect(row.appliedCoverCents).toBe(row.reservedCents);
    }
    // The reversed cover is released: nothing reserved, the notice still
    // records what it had applied.
    expect(audit.reversedDetails).toEqual([
      { reservedCents: 0, availableIsCeiling: true, appliedCoverCents: 231_400 },
    ]);
  });

  test("every cover-resolved notice links to a ledger row carrying its amount and period", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const links = await t.run(async (ctx) => {
      const operations = await ctx.db.query("coverOperations").collect();
      const notices = await ctx.db.query("guaranteeDelinquencyNotices").collect();
      const covered = notices.filter(
        (notice) => notice.resolution?.kind === NOTICE_RESOLUTION_KIND.COVER_COMMITTED,
      );
      return {
        operationCount: operations.length,
        covered: covered.map((notice) => {
          const operation = operations.find((op) => op._id === notice.resolution?.coverOperationId);
          return {
            linked: operation?.noticeId === notice._id,
            publicIdMatches: operation?.publicId === notice.resolution?.coverOperationPublicId,
            status: operation?.status,
            appliedCents: operation?.appliedCents,
            appliedCoverCents: notice.resolution?.appliedCoverCents,
            coveragePeriod: operation?.coveragePeriod,
            rentDueMonth: notice.rentDueDate.slice(0, 7),
            hasPaymentReference: Boolean(operation?.execution?.paymentReference),
            recordedAtMatchesResolution: operation?.recordedAt === notice.resolution?.resolvedAt,
          };
        }),
      };
    });

    expect(links.operationCount).toBe(6);
    expect(links.covered.length).toBe(6);
    for (const row of links.covered) {
      expect(row.linked).toBe(true);
      expect(row.publicIdMatches).toBe(true);
      expect(row.appliedCents).toBe(row.appliedCoverCents);
      expect(row.coveragePeriod).toBe(row.rentDueMonth);
      expect(row.recordedAtMatchesResolution).toBe(true);
      // Only an executed payout carries its off-chain reference.
      expect(row.hasPaymentReference).toBe(row.status === "executed");
    }
    expect(links.covered.map((row) => row.status).sort()).toEqual([
      "executed",
      "executed",
      "executed",
      "executed",
      "recorded",
      "recorded",
    ]);
  });

  test("cover batches: two recorded ops awaiting payout share a batch, as do two executed ones", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const operations = await t.run(async (ctx) => {
      const rows = await ctx.db.query("coverOperations").collect();
      return Promise.all(
        rows.map(async (row) => ({
          publicId: row.publicId,
          status: row.status,
          batchId: row.batchId ?? null,
          recordedAt: row.recordedAt,
          executedAt: row.execution?.executedAt ?? null,
          agencyName: (await ctx.db.get(row.agencyId))?.name ?? null,
          guaranteeStatus: (await ctx.db.get(row.guaranteeId))?.status ?? null,
        })),
      );
    });

    // Live id formats (`generateCoverOperationPublicId` / `generateCoverBatchId`).
    for (const operation of operations) {
      expect(operation.publicId).toMatch(/^COV-[0-9A-HJKMNP-TV-Z]{8}$/);
      if (operation.batchId !== null)
        expect(operation.batchId).toMatch(/^CVB-[0-9A-HJKMNP-TV-Z]{8}$/);
    }

    const recorded = operations.filter((operation) => operation.status === "recorded");
    expect(recorded).toHaveLength(2);
    expect(new Set(recorded.map((operation) => operation.batchId)).size).toBe(1);
    expect(recorded[0]?.batchId).not.toBeNull();
    // One transaction → one recordedAt; recorded this week, on guarantees still
    // in cover_committed, across two agencies.
    expect(new Set(recorded.map((operation) => operation.recordedAt))).toEqual(
      new Set(["2026-09-26T18:10:00.000Z"]),
    );
    expect(recorded.map((operation) => operation.guaranteeStatus)).toEqual([
      GUARANTEE_STATE.COVER_COMMITTED,
      GUARANTEE_STATE.COVER_COMMITTED,
    ]);
    expect(new Set(recorded.map((operation) => operation.agencyName)).size).toBe(2);

    const executedBatches = new Map<string, number>();
    for (const operation of operations) {
      if (operation.status !== "executed" || operation.batchId === null) continue;
      executedBatches.set(operation.batchId, (executedBatches.get(operation.batchId) ?? 0) + 1);
    }
    expect([...executedBatches.values()]).toEqual([2]);
    expect([...executedBatches.keys()][0]).not.toBe(recorded[0]?.batchId);

    // Executed payouts land within the last few weeks to months, never in the future.
    for (const operation of operations.filter((o) => o.status === "executed")) {
      expect(operation.executedAt).not.toBeNull();
      expect((operation.executedAt ?? "") > (operation.recordedAt ?? "")).toBe(true);
      expect((operation.executedAt ?? "") < SEED_NOW).toBe(true);
    }
  });

  test("no lease carries more than one non-closed guarantee, and openGuaranteeId points at it", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const audit = await t.run(async (ctx) => {
      const leases = await ctx.db.query("leases").collect();
      const violations: string[] = [];
      let leasesWithOpen = 0;
      for (const lease of leases) {
        const guarantees = await ctx.db
          .query("guarantees")
          .withIndex("by_lease", (q) => q.eq("leaseId", lease._id))
          .collect();
        if (guarantees.length === 0) violations.push(`${lease.publicId}: no guarantee`);
        const open = guarantees.filter((g) => g.status !== GUARANTEE_STATE.CLOSED);
        if (open.length > 1) violations.push(`${lease.publicId}: ${open.length} open guarantees`);
        const expectedPointer = open.length === 1 ? open[0]._id : null;
        if (lease.openGuaranteeId !== expectedPointer) {
          violations.push(`${lease.publicId}: openGuaranteeId does not match the open guarantee`);
        }
        if (expectedPointer !== null) leasesWithOpen += 1;
        for (const g of guarantees) {
          if (g.agencyId !== lease.agencyId) {
            violations.push(`${lease.publicId}: guarantee ${g.publicId} in another agency`);
          }
        }
      }
      return { total: leases.length, leasesWithOpen, violations };
    });

    // One lease per seeded guarantee (58 fictional + 11 Aprovada) except the
    // renewed Aprovada lease, which carries two. Four closed guarantees leave
    // their lease with a null pointer; the fifth's lease points at its
    // successor.
    expect(audit.total).toBe(68);
    expect(audit.leasesWithOpen).toBe(64);
    expect(audit.violations).toEqual([]);
  });

  test("one Aprovada lease carries two guarantees: a closed first term and the open renewal", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const aprovadaId = await agencyIdByName(t, "Imobiliária Aprovada");
    const renewed = await t.run(async (ctx) => {
      const leases = await ctx.db
        .query("leases")
        .withIndex("by_agency", (q) => q.eq("agencyId", aprovadaId))
        .collect();
      const multi = [];
      for (const lease of leases) {
        const guarantees = await ctx.db
          .query("guarantees")
          .withIndex("by_lease", (q) => q.eq("leaseId", lease._id))
          .collect();
        if (guarantees.length < 2) continue;
        const open = guarantees.filter((g) => g.status !== GUARANTEE_STATE.CLOSED);
        multi.push({
          guarantees: guarantees
            .map((g) => `${g.publicId}:${g.status}:${g.closure?.reason ?? "-"}`)
            .sort(),
          pointsAtOpen: open.length === 1 && lease.openGuaranteeId === open[0]?._id,
          renewalAfterClose:
            (open[0]?.activatedAt ?? "") >
            (guarantees.find((g) => g.status === GUARANTEE_STATE.CLOSED)?.closure?.closedAt ?? ""),
        });
      }
      return multi;
    });

    expect(renewed).toEqual([
      {
        guarantees: ["1000036:closed:end_of_lease", "1000041:active:-"],
        pointsAtOpen: true,
        renewalAfterClose: true,
      },
    ]);
  });

  test("registers tenants and links every seeded lease by tenantId", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    // The registry must be populated — seedFictional + populateAprovadaBook
    // run every lease's tenant block through getOrCreateTenant.
    expect(await tenantCount(t)).toBeGreaterThan(0);

    // Registry-only: every seeded lease carries the registry link (tenantId)
    // and no embedded tenant — the link is the only tenant ref, and the
    // guarantee reaches the tenant through its lease.
    const aprovadaId = await agencyIdByName(t, "Imobiliária Aprovada");
    const linked = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("guarantees")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", aprovadaId))
        .collect();
      const resolvedTenants = await Promise.all(
        rows.map(async (r) => {
          const lease = await ctx.db.get(r.leaseId);
          return lease ? ctx.db.get(lease.tenantId) : null;
        }),
      );
      return {
        total: rows.length,
        withResolvableTenant: resolvedTenants.filter((tenant) => tenant !== null).length,
      };
    });
    expect(linked.total).toBeGreaterThan(0);
    // The lease → tenantId link must resolve to a real registry row for every guarantee.
    expect(linked.withResolvableTenant).toBe(linked.total);
  });

  test("gives every guarantee its own tenant submission, so the read paths can fail closed", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    // The read paths no longer fall back to the shared registry row — serving
    // it would show one agency the identity another agency submitted for the
    // same person. That fail-closed choice is only safe while every guarantee
    // carries a submission of its own, which is what this asserts.
    const missing = await t.run(async (ctx) => {
      const guarantees = await ctx.db.query("guarantees").collect();
      const withoutSnapshot: string[] = [];
      for (const guarantee of guarantees) {
        const history = await ctx.db
          .query("guaranteeHistory")
          .withIndex("by_agency_guarantee", (q) =>
            q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", guarantee.publicId),
          )
          .collect();
        if (!history.some((entry) => entry.tenantSnapshot !== undefined)) {
          withoutSnapshot.push(guarantee.publicId);
        }
      }
      return { total: guarantees.length, withoutSnapshot };
    });

    expect(missing.total).toBeGreaterThan(0);
    expect(missing.withoutSnapshot).toEqual([]);
  });

  test("the snapshot is found by content, not by sort order", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    // The index returns rows in insertion order, not by `at`. A reader that
    // took whichever row sorts or lands first would miss the snapshot the
    // moment any earlier-dated row is appended, and fall through to the
    // shared registry row.
    const probe = await t.run(async (ctx) => {
      const guarantee = await ctx.db.query("guarantees").first();
      if (!guarantee) throw new Error("seed produced no guarantees");
      await ctx.db.insert("guaranteeHistory", {
        agencyId: guarantee.agencyId,
        guaranteePublicId: guarantee.publicId,
        at: "2020-01-01T00:00:00.000Z",
        username: "probe",
        message: "sorts first, carries no snapshot",
      });
      const history = await ctx.db
        .query("guaranteeHistory")
        .withIndex("by_agency_guarantee", (q) =>
          q.eq("agencyId", guarantee.agencyId).eq("guaranteePublicId", guarantee.publicId),
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
        propertyKind: "residential",
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

  test("reseeding twice leaves one product and one Aprovada book — the wipe covers the new tables", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});
    await t.mutation(internal.seed.seedReset, {});

    const counts = await t.run(async (ctx) => ({
      products: (await ctx.db.query("products").collect()).length,
      leases: (await ctx.db.query("leases").collect()).length,
      guarantees: (await ctx.db.query("guarantees").collect()).length,
    }));
    expect(counts.products).toBe(1);
    expect(counts.leases).toBe(68);
    expect(counts.guarantees).toBe(69);
  });

  test("agencyowner's agency walks every one of the seven guarantee states", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const aprovadaId = await agencyIdByName(t, "Imobiliária Aprovada");
    const states = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("guarantees")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", aprovadaId))
        .collect();
      return [...new Set(rows.map((row) => row.status))].sort();
    });

    expect(states).toEqual([...GUARANTEE_STATES].sort());
  });

  test("the defaults queue holds at least three verified defaults across at least two agencies", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const verified = await t.run(async (ctx) => {
      const notices = await ctx.db.query("guaranteeDelinquencyNotices").collect();
      const rows = [];
      for (const notice of notices.filter((n) => n.status === DELINQUENCY_STATUS.VERIFIED)) {
        const guarantee = await ctx.db.get(notice.guaranteeId);
        const agency = await ctx.db.get(notice.agencyId);
        rows.push({
          agency: agency?.name ?? null,
          guaranteeStatus: guarantee?.status ?? null,
          verifiedAt: notice.verification?.verifiedAt ?? "",
        });
      }
      return rows;
    });

    expect(verified.length).toBeGreaterThanOrEqual(3);
    expect(new Set(verified.map((row) => row.agency)).size).toBeGreaterThanOrEqual(2);
    for (const row of verified) {
      expect(row.guaranteeStatus).toBe(GUARANTEE_STATE.DEFAULT_VERIFIED);
      // Waiting days, not months: verified within the last two weeks.
      expect(row.verifiedAt >= "2026-09-14").toBe(true);
      expect(row.verifiedAt < SEED_NOW).toBe(true);
    }
  });

  test("the notice book carries a staff dismissal and a staff dispute with their guarantee outcomes", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const book = await t.run(async (ctx) => {
      const notices = await ctx.db.query("guaranteeDelinquencyNotices").collect();
      const withGuarantee = async (notice: (typeof notices)[number]) => ({
        publicId: notice.publicId,
        status: notice.status,
        openedAt: notice.openedAt,
        guarantee: await ctx.db.get(notice.guaranteeId),
      });
      const dismissed = notices.filter(
        (n) => n.cancellation?.reason === NOTICE_CANCELLATION_REASON.STAFF_DISMISSED,
      );
      const disputed = notices.filter(
        (n) => n.resolution?.kind === NOTICE_RESOLUTION_KIND.STAFF_DISPUTE,
      );
      const open = notices.filter((n) => n.status === DELINQUENCY_STATUS.OPEN);
      return {
        dismissed: await Promise.all(dismissed.map(withGuarantee)),
        disputed: await Promise.all(disputed.map(withGuarantee)),
        open: await Promise.all(open.map(withGuarantee)),
      };
    });

    // Dismissal hands the guarantee back its performing state.
    expect(book.dismissed.map((n) => [n.status, n.guarantee?.status])).toEqual([
      ["canceled", GUARANTEE_STATE.ACTIVE],
    ]);
    // Dispute leaves the guarantee in default: 1000032 stays in arrears, and
    // the fresh notice filed this week sits open on the same guarantee.
    expect(
      book.disputed.map((n) => [n.status, n.guarantee?.publicId, n.guarantee?.status]),
    ).toEqual([["resolved", "1000032", GUARANTEE_STATE.IN_ARREARS]]);
    expect(book.open.map((n) => [n.guarantee?.publicId, n.openedAt])).toEqual([
      ["1000032", "2026-09-24T12:19:00.000Z"],
    ]);
  });

  test("the transparency figures read like a real book: ~10% default rate, aggregates match the table", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const figures = await t.run(async (ctx) => {
      const rows = await ctx.db.query("guarantees").collect();
      const tableCounts: Record<string, number> = {};
      for (const row of rows) tableCounts[row.status] = (tableCounts[row.status] ?? 0) + 1;
      const countByState = await countByStatePlatform(ctx);
      const insured = await countInsured(ctx);
      return {
        tableCounts,
        countByState,
        insured,
        verifiedDefault: countByState.default_verified + countByState.cover_committed,
        sumInsuredCents: await sumInsuredExposure(ctx),
        verifiedDefaultExposureCents: await sumVerifiedDefaultExposure(ctx),
      };
    });

    // Aggregate ↔ table consistency: the B-trees the transparency page reads
    // agree with the rows the seed wrote.
    for (const state of GUARANTEE_STATES) {
      expect(figures.countByState[state], state).toBe(figures.tableCounts[state] ?? 0);
    }
    // Same formula as `getGuaranteeAggregates`: (default_verified +
    // cover_committed) / in-force.
    expect(figures.verifiedDefault).toBe(6);
    expect(figures.insured).toBe(58);
    expect(figures.verifiedDefault / figures.insured).toBeCloseTo(0.1034, 3);
    expect(figures.sumInsuredCents).toBe(SUM_INSURED_CENTS);
    expect(figures.verifiedDefaultExposureCents).toBe(VERIFIED_DEFAULT_EXPOSURE_CENTS);
  });

  test("the newest invoice of every agency is the current month, and no invoice bills a guarantee before its activation", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const audit = await t.run(async (ctx) => {
      const agencies = await ctx.db.query("agencies").collect();
      const invoices = await ctx.db.query("invoices").collect();
      const newestByAgency: Record<string, string> = {};
      const billedBeforeActivation: string[] = [];
      for (const invoice of invoices) {
        if (invoice.publicId.startsWith("INV-TEST-")) continue;
        const name = agencies.find((a) => a._id === invoice.agencyId)?.name ?? "?";
        if ((newestByAgency[name] ?? "") < invoice.periodMonth) {
          newestByAgency[name] = invoice.periodMonth;
        }
        for (const item of invoice.lineItems) {
          const guarantee = await ctx.db.get(item.guaranteeId);
          const activatedMonth = guarantee?.activatedAt?.slice(0, 7) ?? "9999-99";
          if (activatedMonth > invoice.periodMonth) {
            billedBeforeActivation.push(`${invoice.publicId}:${item.guaranteePublicId}`);
          }
        }
      }
      // Convex field names are ASCII-only, so the map leaves as entries.
      return { newestByAgency: Object.entries(newestByAgency).sort(), billedBeforeActivation };
    });

    expect(audit.newestByAgency).toEqual([
      ["Horizonte Imóveis", "2026-09"],
      ["Imobiliária Aprovada", "2026-09"],
      ["Imobiliária Atlântica", "2026-09"],
      ["Imobiliária Paulista", "2026-09"],
    ]);
    expect(audit.billedBeforeActivation).toEqual([]);
  });

  test("no current-month invoice is born overdue, whatever day of the month the reseed runs", async () => {
    // The 1st, mid-month, the 28th and the 31st: the current month's due date
    // must never sit before the reseed day.
    const clocks = [
      "2026-10-01T15:00:00.000Z",
      "2026-10-15T15:00:00.000Z",
      "2026-10-28T15:00:00.000Z",
      "2026-10-31T15:00:00.000Z",
    ];
    const agencies = ["Imobiliária Paulista", "Imobiliária Atlântica", "Imobiliária Aprovada"];
    for (const clock of clocks) {
      vi.setSystemTime(new Date(clock));
      const today = clock.slice(0, 10);
      const t = setup();
      await t.mutation(internal.seed.seedReset, {});

      const current = await t.run(async (ctx) => {
        const agencyRows = await ctx.db.query("agencies").collect();
        const ids = new Set(agencyRows.filter((a) => agencies.includes(a.name)).map((a) => a._id));
        return (await ctx.db.query("invoices").collect()).filter(
          (invoice) => ids.has(invoice.agencyId) && invoice.periodMonth === today.slice(0, 7),
        );
      });

      // One recurring invoice per agency plus the testnet ones for Paulista
      // and Atlântica.
      expect(current.length, clock).toBeGreaterThanOrEqual(agencies.length);
      expect(
        current.filter((invoice) => isOverdue(invoice, today)).map((invoice) => invoice.publicId),
        clock,
      ).toEqual([]);
    }
  }, 60_000);

  test("seeded tax ids are obviously synthetic and unique (LGPD: the agency screens show them in full)", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const taxIds = await t.run(async (ctx) =>
      (await ctx.db.query("tenants").collect()).map((tenant) => tenant.taxId),
    );

    expect(taxIds.length).toBeGreaterThan(0);
    // Either the `000.000.1NN-XX` range `seedCpf` generates, or a literal whose
    // body repeats one digit or one digit pair (`77777777…`, `72727272…`).
    const synthetic = (taxId: string) =>
      taxId.startsWith("000000") || /^(\d)\1{7}/.test(taxId) || /^(\d\d)\1{3}/.test(taxId);
    expect(taxIds.filter((taxId) => !synthetic(taxId))).toEqual([]);
    expect(new Set(taxIds).size).toBe(taxIds.length);
  });

  test("seeded payment instruments are unmistakably fake", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const methods = await t.run(async (ctx) =>
      (await ctx.db.query("payments").collect()).map((payment) => payment.method),
    );

    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      if (method.kind === "pix") {
        expect(method.pixKey).toContain("00000000-0000-0000-0000-000000000000");
        expect(method.txId).toMatch(/^E00000000\d{12}DEMO\d{7}$/);
      }
      if (method.kind === "boleto") {
        expect(method.barcode).toMatch(/^[0 .]+$/);
      }
    }
  });

  test("transition history speaks pt-BR labels, never raw enum values", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const messages = await t.run(async (ctx) =>
      (await ctx.db.query("guaranteeHistory").collect()).map((row) => row.message),
    );

    expect(messages.filter((message) => /\([a-z]+_[a-z_]+\)/.test(message))).toEqual([]);
    expect(messages).toContain("Garantia 1000040 encerrada: contestação revertida.");
  });

  test("the seed writes no audit rows — the prod chain is never wiped, so seeded entries would dangle", async () => {
    const t = setup();
    await t.mutation(internal.seed.seedReset, {});

    const auditRows = await t.run(
      async (ctx) => (await ctx.db.query("mutavAuditLog").collect()).length,
    );
    expect(auditRows).toBe(0);
  });
});
