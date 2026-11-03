// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../_generated/api";
import { GUARANTEE_STATE } from "../guarantees/domain";
import {
  registerGuaranteeAggregateComponents,
  seedAgencyWithMembership,
  seedGuaranteeWithLease,
  setupAuthenticatedUser,
} from "../lib/testFixtures";
import schema from "../schema";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// The default product's exit-cost sublimit, added to each in-force guarantee's cover.
const EXIT_CAP_CENTS = 600_000;
const VAULT = "925hnJ7MrnAHqkvhRNBB3zYLsSACWQhHeDUB3Q4V9zvC";
const BRS_MINT = "BRSxQRUaGswjLs7ewcH7uXj3r7SgmfKSSLLXyCKHZtUo";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SOURCE = { kind: "squads_multisig" as const, vaultAddress: VAULT, slot: 7 };
const ENV_KEYS = ["SOLANA_RPC_URL", "RESERVE_SQUADS_VAULT_ADDRESS", "RESERVE_BRS_MINT"] as const;
const SOL_HOLDING = {
  mint: WSOL_MINT,
  symbol: "SOL",
  kind: "sol" as const,
  tokenProgram: "native" as const,
  decimals: 9,
  amountBaseUnits: "2039280",
  valueCents: 152,
  counted: false,
};
const BRS_HOLDING = {
  mint: BRS_MINT,
  symbol: "BRS",
  kind: "brl_stable" as const,
  tokenProgram: "spl-token" as const,
  decimals: 6,
  amountBaseUnits: "12345670000",
  valueCents: 1_234_567,
  counted: true,
};
const PRICES = {
  usdBrl: { rate: 5, source: "BCB_PTAX_VENDA", quotedAt: "2026-10-30 13:09:27" },
  solUsd: { price: 150, source: "JUPITER_PRICE_V3" },
};
const READING = {
  holdings: [SOL_HOLDING, BRS_HOLDING],
  prices: PRICES,
  usdStablesUncounted: false,
};

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

async function bookWithActiveCover(availableCents: number[]) {
  const t = convexTest(schema);
  registerGuaranteeAggregateComponents(t);
  const { asUser, userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId);
  for (const [index, cents] of availableCents.entries()) {
    await seedGuaranteeWithLease(
      t,
      { agencyId, status: GUARANTEE_STATE.ACTIVE, availableCents: cents },
      `H${index}`,
    );
  }
  // Outside the book: a draft carries no cover.
  await seedGuaranteeWithLease(
    t,
    { agencyId, status: GUARANTEE_STATE.DRAFTED, availableCents: 9_000_000 },
    "HDRAFT",
  );
  return { t, asUser };
}

function listSnapshots(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("reserveHealthSnapshots").collect());
}

describe("writeHealthSnapshot", () => {
  test("stores the balance in cents and the in-force cover summed from the book", async () => {
    const { t } = await bookWithActiveCover([1_000_000, 2_000_000]);
    await t.mutation(internal.reserve.useCases.writeHealthSnapshot, {
      capturedAt: 1_000,
      source: SOURCE,
      balanceBaseUnits: "12345670000", // 12_345.67 BRS
      coverageRatioBps: 2_500,
      ...READING,
    });
    const [row] = await listSnapshots(t);
    expect(row).toMatchObject({
      capturedAt: 1_000,
      source: SOURCE,
      balanceBaseUnits: "12345670000",
      balanceCents: 1_234_567,
      insuredCoverCents: 3_000_000 + 2 * EXIT_CAP_CENTS,
      coverageRatioBps: 2_500,
      ...READING,
    });
    expect(row?.activeOfferHoldsCents).toBeUndefined();
  });

  test("refuses a balance that is not an unsigned integer string", async () => {
    const { t } = await bookWithActiveCover([]);
    await expect(
      t.mutation(internal.reserve.useCases.writeHealthSnapshot, {
        capturedAt: 1,
        source: SOURCE,
        balanceBaseUnits: "-5",
        coverageRatioBps: 2_500,
        ...READING,
      }),
    ).rejects.toThrow(/unsigned/);
  });
});

describe("refreshReserveHealth (mocked RPC)", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.SOLANA_RPC_URL = "https://rpc.test.invalid";
    process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
    delete process.env.RESERVE_BRS_MINT;
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Answers getBalance with the rent minimum and the Tokenkeg query with `splAccounts`; prices up. */
  function chainReturns(splAccounts: unknown[], slot = 321) {
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchFn>(async (input, init) => {
        const url = String(input);
        if (url.includes("olinda.bcb.gov.br")) {
          return new Response(JSON.stringify({ value: [{ cotacaoVenda: 5 }] }));
        }
        if (url.includes("jup.ag")) {
          return new Response(JSON.stringify({ [WSOL_MINT]: { usdPrice: 150 } }));
        }
        const { method, params } = JSON.parse(String(init?.body)) as {
          method: string;
          params: [string, { programId?: string }];
        }; // hook-ok: test fixture
        const value =
          method === "getBalance"
            ? 2_039_280
            : params[1].programId === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
              ? splAccounts
              : [];
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { context: { slot }, value } }),
        );
      }),
    );
  }

  test("writes a snapshot from a good vault read", async () => {
    const { t } = await bookWithActiveCover([400_000]);
    chainReturns([
      {
        account: {
          data: {
            program: "spl-token",
            parsed: {
              info: {
                mint: BRS_MINT,
                owner: VAULT,
                tokenAmount: { amount: "50000000000", decimals: 6 },
              },
            },
          },
        },
      },
    ]);
    await t.action(internal.reserve.healthActions.refreshReserveHealth, {});
    const rows = await listSnapshots(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: { ...SOURCE, slot: 321 },
      balanceBaseUnits: "50000000000",
      balanceCents: 5_000_000,
      insuredCoverCents: 400_000 + EXIT_CAP_CENTS,
      coverageRatioBps: 2_500,
      holdings: [
        { ...SOL_HOLDING, valueCents: 152 },
        { ...BRS_HOLDING, amountBaseUnits: "50000000000", valueCents: 5_000_000 },
      ],
      usdStablesUncounted: false,
    });
  });

  test("an empty vault writes a 0-balance snapshot, not nothing", async () => {
    const { t } = await bookWithActiveCover([400_000]);
    chainReturns([]);
    await t.action(internal.reserve.healthActions.refreshReserveHealth, {});
    const rows = await listSnapshots(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ balanceBaseUnits: "0", balanceCents: 0 });
  });

  test("writes nothing when the read fails closed", async () => {
    const { t } = await bookWithActiveCover([400_000]);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    await t.action(internal.reserve.healthActions.refreshReserveHealth, {});
    expect(await listSnapshots(t)).toHaveLength(0);
  });

  test("writes nothing when the reserve is not configured", async () => {
    const { t } = await bookWithActiveCover([]);
    delete process.env.RESERVE_SQUADS_VAULT_ADDRESS;
    await t.action(internal.reserve.healthActions.refreshReserveHealth, {});
    expect(await listSnapshots(t)).toHaveLength(0);
  });
});

describe("transparency.getReserveHealth", () => {
  test("is unavailable before the first snapshot", async () => {
    const { asUser } = await bookWithActiveCover([]);
    expect(await asUser.query(api.transparency.useCases.getReserveHealth, {})).toEqual({
      available: false,
      vaultExplorerUrl: null,
    });
  });

  test("still links the configured vault while no snapshot exists", async () => {
    const { asUser } = await bookWithActiveCover([]);
    const saved = process.env.RESERVE_SQUADS_VAULT_ADDRESS;
    process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
    try {
      expect(await asUser.query(api.transparency.useCases.getReserveHealth, {})).toEqual({
        available: false,
        vaultExplorerUrl: `https://explorer.solana.com/address/${VAULT}`,
      });
    } finally {
      if (saved === undefined) delete process.env.RESERVE_SQUADS_VAULT_ADDRESS;
      else process.env.RESERVE_SQUADS_VAULT_ADDRESS = saved;
    }
  });

  test("derives the figures from the latest snapshot", async () => {
    const { t, asUser } = await bookWithActiveCover([]);
    const insert = (capturedAt: number, balanceCents: number) =>
      t.run((ctx) =>
        ctx.db.insert("reserveHealthSnapshots", {
          capturedAt,
          source: SOURCE,
          balanceBaseUnits: String(balanceCents * 10_000),
          balanceCents,
          insuredCoverCents: 4_000_000,
          coverageRatioBps: 2_500,
          ...READING,
          usdStablesUncounted: capturedAt === 2_000,
        }),
      );
    await insert(1_000, 1);
    await insert(2_000, 3_000_000);
    expect(await asUser.query(api.transparency.useCases.getReserveHealth, {})).toEqual({
      available: true,
      capturedAt: 2_000,
      source: SOURCE,
      vaultExplorerUrl: `https://explorer.solana.com/address/${VAULT}`,
      holdings: [SOL_HOLDING, BRS_HOLDING],
      prices: PRICES,
      usdStablesUncounted: true,
      balanceCents: 3_000_000,
      insuredCoverCents: 4_000_000,
      coverageRatioBps: 2_500,
      activeOfferHoldsCents: 0,
      requiredCoverageCents: 1_000_000,
      coverageRatio: 3,
      freeCapitalCents: 2_000_000,
      meetsRequiredCoverage: true,
    });
  });
});
