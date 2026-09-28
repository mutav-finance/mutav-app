// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import { GUARANTEE_STATE, type GuaranteeState } from "../guarantees/domain";
import {
  registerGuaranteeAggregateComponents,
  seedAgencyWithMembership,
  seedGuaranteeWithLease,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

// getReserveCoverage is wrapped in queryWithAuth, which requires a provisioned
// user row matched by JWT subject. Provision one and call via withIdentity so the
// auth wrapper resolves — the coverage behavior under test is unchanged.
async function authedReader() {
  const t = convexTest(schema);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: "reader",
      subject: "auth0|reader",
      name: "Reader",
      email: "reader@test.br",
      createdAt: new Date().toISOString(),
    }),
  );
  return t.withIdentity({ subject: "auth0|reader", email: "reader@test.br", name: "Reader" });
}

describe("getGuaranteeAggregates — defaultRate", () => {
  async function bookWith(states: readonly GuaranteeState[]) {
    const t = convexTest(schema);
    registerGuaranteeAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    let index = 0;
    for (const status of states) {
      index++;
      await seedGuaranteeWithLease(t, { agencyId, status }, `D${index}`);
    }
    return asUser.query(api.transparency.useCases.getGuaranteeAggregates, {});
  }

  test("is null when nothing is in force — a rate needs a denominator, not a zero", async () => {
    const aggregates = await bookWith([GUARANTEE_STATE.DRAFTED, GUARANTEE_STATE.CLOSED]);
    expect(aggregates.countInsured).toBe(0);
    expect(aggregates.defaultRate).toBeNull();
  });

  test("is (default_verified + cover_committed) over the in-force book", async () => {
    const aggregates = await bookWith([
      GUARANTEE_STATE.ACTIVE,
      GUARANTEE_STATE.ACTIVE,
      GUARANTEE_STATE.IN_ARREARS,
      GUARANTEE_STATE.DEFAULT_VERIFIED,
      GUARANTEE_STATE.COVER_COMMITTED,
    ]);
    expect(aggregates.countInsured).toBe(5);
    expect(aggregates.defaultRate).toBeCloseTo(0.4, 10);
  });

  test("excludes arrears from the numerator — an unverified claim must not move the figure", async () => {
    const aggregates = await bookWith([
      GUARANTEE_STATE.ACTIVE,
      GUARANTEE_STATE.IN_ARREARS,
      GUARANTEE_STATE.IN_ARREARS,
      GUARANTEE_STATE.IN_EVICTION,
    ]);
    expect(aggregates.countInsured).toBe(4);
    expect(aggregates.defaultRate).toBe(0);
  });

  test("drafted and closed rows are outside the denominator", async () => {
    const aggregates = await bookWith([
      GUARANTEE_STATE.DEFAULT_VERIFIED,
      GUARANTEE_STATE.DRAFTED,
      GUARANTEE_STATE.DRAFTED,
      GUARANTEE_STATE.CLOSED,
    ]);
    expect(aggregates.countInsured).toBe(1);
    expect(aggregates.defaultRate).toBe(1);
  });
});

const EXIT_CAP_CENTS = 600_000;

describe("getGuaranteeAggregates — money figures", () => {
  test("verified-default exposure sums default_verified + cover_committed exposure only", async () => {
    const t = convexTest(schema);
    registerGuaranteeAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    const specs = [
      { status: GUARANTEE_STATE.ACTIVE, availableCents: 1_000_000 },
      { status: GUARANTEE_STATE.IN_ARREARS, availableCents: 2_000_000 },
      { status: GUARANTEE_STATE.DEFAULT_VERIFIED, availableCents: 300_000 },
      { status: GUARANTEE_STATE.COVER_COMMITTED, availableCents: 40_000 },
      { status: GUARANTEE_STATE.CLOSED, availableCents: 9_000_000 },
    ];
    for (const [index, spec] of specs.entries()) {
      await seedGuaranteeWithLease(t, { agencyId, ...spec }, `M${index}`);
    }
    const aggregates = await asUser.query(api.transparency.useCases.getGuaranteeAggregates, {});

    // Exposure per row = available capacity + the default product's R$ 6.000 exit sublimit.
    expect(aggregates.countVerifiedDefault).toBe(2);
    expect(aggregates.verifiedDefaultExposureCents).toBe(300_000 + 40_000 + 2 * EXIT_CAP_CENTS);
    expect(aggregates.sumInsuredCents).toBe(3_340_000 + 4 * EXIT_CAP_CENTS);
  });

  test("verified-default exposure is zero on a clean book", async () => {
    const t = convexTest(schema);
    registerGuaranteeAggregateComponents(t);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);
    await seedGuaranteeWithLease(t, { agencyId, status: GUARANTEE_STATE.ACTIVE }, "C1");
    const aggregates = await asUser.query(api.transparency.useCases.getGuaranteeAggregates, {});
    expect(aggregates.verifiedDefaultExposureCents).toBe(0);
  });
});

describe("getReserveCoverage", () => {
  test("reports unavailable with the testnet contract explorer url when no snapshot exists", async () => {
    const reader = await authedReader();
    const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(false);
    expect(typeof coverage.explorerUrl).toBe("string");
    expect(coverage.explorerUrl).toContain("/contract/");
  });

  test("explorer url omits /contract/ when no contract id is configured (public net, unset)", async () => {
    const original = process.env.STELLAR_NETWORK; // hook-ok: test env manipulation for isolation
    process.env.STELLAR_NETWORK = "public"; // hook-ok: test env manipulation for isolation
    delete process.env.STELLAR_RESERVE_CONTRACT_ID; // hook-ok: test env manipulation for isolation
    try {
      const reader = await authedReader();
      const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
      expect(coverage.available).toBe(false);
      expect(coverage.explorerUrl).not.toContain("/contract/");
      expect(coverage.explorerUrl.endsWith("/explorer/public")).toBe(true);
    } finally {
      if (original === undefined)
        delete process.env.STELLAR_NETWORK; // hook-ok: test env manipulation for isolation
      else process.env.STELLAR_NETWORK = original; // hook-ok: test env manipulation for isolation
    }
  });

  test("returns the latest snapshot when one exists", async () => {
    const reader = await authedReader();
    await reader.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 50784300,
      fxUsdBrl: 5.42,
      fxSource: "BCB_PTAX_VENDA",
      fxQuotedAt: "2026-06-10 13:12:50",
      assets: [
        {
          contractAddress: "C1",
          symbol: "BRLT",
          decimals: 7,
          rawBalance: "5078430000000",
          valueCents: 50784300,
        },
      ],
      capturedAt: 1717000000000,
    });
    const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(true);
    if (coverage.available) {
      expect(coverage.storedValueCents).toBe(50784300);
      expect(coverage.capturedAt).toBe(1717000000000);
      expect(coverage.assetCount).toBe(1);
      // A snapshot written before the pulse read carries no solvency block.
      expect(coverage.solvency).toBeNull();
    }
  });

  test("surfaces the pulse solvency figures, contract ids and network", async () => {
    const reader = await authedReader();
    await reader.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 195_520_000,
      fxUsdBrl: 5.44,
      fxSource: "BCB_PTAX_VENDA",
      fxQuotedAt: "2026-09-26 13:09:28",
      assets: [
        {
          contractAddress: "CUSDSAC",
          symbol: "cUSD",
          decimals: 7,
          rawBalance: "3594856574762",
          valueCents: 195_520_000,
        },
      ],
      capturedAt: 1_790_000_000_000,
      solvency: {
        vaultId: "CVAULT",
        policyId: "CPOLICY",
        registryId: "CREGISTRY",
        assetContractId: "CUSDSAC",
        assetSymbol: "cUSD",
        assetDecimals: 7,
        totalAssetsRaw: "3594856574762",
        stableAssetsRaw: "3594856574762",
        freeCapitalRaw: "2334856574762",
        coverageRequiredRaw: "1260000000000",
        rawCoverageRaw: "1260000000000",
        coverageRatioBps: 10_000,
        positions: [
          { kind: "idle", address: "CVAULT", volatile: false, rawBalance: "2100000000" },
          { kind: "strategy", address: "CSTRAT", volatile: false, rawBalance: "3592756574762" },
        ],
      },
    });
    const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
    if (!coverage.available) throw new Error("expected an available snapshot");
    const solvency = coverage.solvency;
    if (!solvency) throw new Error("expected a solvency block");

    expect(solvency.network).toBe("testnet");
    expect(solvency.assetSymbol).toBe("cUSD");
    expect(solvency.contracts).toEqual({
      vault: {
        id: "CVAULT",
        explorerUrl: "https://stellar.expert/explorer/testnet/contract/CVAULT",
      },
      policy: {
        id: "CPOLICY",
        explorerUrl: "https://stellar.expert/explorer/testnet/contract/CPOLICY",
      },
      registry: {
        id: "CREGISTRY",
        explorerUrl: "https://stellar.expert/explorer/testnet/contract/CREGISTRY",
      },
    });
    expect(solvency.totalAssets).toBeCloseTo(359485.6574762, 7);
    expect(solvency.remainingCapacity).toBeCloseTo(233485.6574762, 7);
    expect(solvency.coverageRequired).toBe(126000);
    expect(solvency.coverageRatio).toBeCloseTo(2.8530607736, 9);
    expect(solvency.requiredCoverageRatio).toBe(1);
    expect(solvency.capacityCeiling).toBeCloseTo(359485.6574762, 7);
    expect(solvency.positions).toHaveLength(2);
    expect(solvency.positions[1]?.explorerUrl).toBe(
      "https://stellar.expert/explorer/testnet/contract/CSTRAT",
    );
  });

  test("reports unavailable when the latest snapshot has no priced value (held-but-unpriced)", async () => {
    const reader = await authedReader();
    // Vault holds an asset, but its symbol isn't in the BRL/USD price lists, so
    // every valueCents is 0 → headline R$ 0,00 must show "unavailable", not a number.
    await reader.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 0,
      fxUsdBrl: 5.42,
      fxSource: "BCB_PTAX_VENDA",
      fxQuotedAt: "2026-06-10 13:12:50",
      assets: [
        {
          contractAddress: "C9",
          symbol: "XLM",
          decimals: 7,
          rawBalance: "1000000000",
          valueCents: 0,
        },
      ],
      capturedAt: 1717000000000,
    });
    const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(false);
    expect(coverage.explorerUrl).toContain("/contract/");
  });
});
