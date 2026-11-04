import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  assembleHoldings,
  parseNativeBalanceResponse,
  parseTokenAccountsResponse,
  readSquadsCapacity,
  squadsReserveReader,
  type SquadsReserveConfig,
} from "./squadsReader";
import { reserveAssetRegistry } from "./assets";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// The real mainnet vault and mints (public addresses). The RPC URL is a fake
// carrying a fake API key, so a test can prove the key never reaches a log.
const VAULT = "925hnJ7MrnAHqkvhRNBB3zYLsSACWQhHeDUB3Q4V9zvC";
const BRS_MINT = "BRSxQRUaGswjLs7ewcH7uXj3r7SgmfKSSLLXyCKHZtUo";
const BRS_DEVNET_MINT = "BRS2CELW6Cueo2mrMUVvAr5GDT7Pw8TeostC2JLMpBk4";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const UNKNOWN_MINT = "Unkn0wnMintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1";
const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const API_KEY = "test-api-key-0000";
const CONFIG: SquadsReserveConfig = {
  rpcUrl: `https://rpc.test.invalid/?api-key=${API_KEY}`,
  vaultAddress: VAULT,
  brsMint: BRS_MINT,
};
// What the vault holds today: only the rent-exempt minimum.
const RENT_LAMPORTS = 2_039_280;

type Program = "spl-token" | "spl-token-2022";

function tokenAccount({
  amount,
  mint = BRS_MINT,
  owner = VAULT,
  decimals = 6,
  program = "spl-token",
}: {
  amount: string;
  mint?: string;
  owner?: string;
  decimals?: number;
  program?: string;
}) {
  return {
    pubkey: "AtaPubkey",
    account: {
      data: {
        program,
        parsed: {
          type: "account",
          info: { mint, owner, tokenAmount: { amount, decimals, uiAmountString: "ignored" } },
        },
      },
    },
  };
}

function rpcBody(value: unknown, slot = 4242) {
  return { jsonrpc: "2.0", id: 1, result: { context: { slot }, value } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type ChainState = {
  lamports?: number;
  splToken?: unknown[];
  token2022?: unknown[];
  slots?: { balance?: number; splToken?: number; token2022?: number };
};

type Feeds = {
  /** PTAX venda rate, or "down" for an HTTP 503. */
  ptax?: number | "down";
  /** Jupiter SOL/USD, or "down" for an HTTP 503. */
  solUsd?: number | "down";
};

/** A fetch that answers like the Solana RPC, BCB PTAX and Jupiter would — never the network. */
function stubNetwork(chain: ChainState, feeds: Feeds = {}) {
  const fetchMock = vi.fn<FetchFn>(async (input, init) => {
    const url = String(input);
    if (url.includes("olinda.bcb.gov.br")) {
      if (feeds.ptax === undefined || feeds.ptax === "down") return jsonResponse({}, 503);
      return jsonResponse({
        value: [{ cotacaoVenda: feeds.ptax, dataHoraCotacao: "2026-10-30 13:09:27.123" }],
      });
    }
    if (url.includes("jup.ag")) {
      if (feeds.solUsd === undefined || feeds.solUsd === "down") return jsonResponse({}, 503);
      return jsonResponse({ [WSOL_MINT]: { usdPrice: feeds.solUsd, decimals: 9 } });
    }
    if (url !== CONFIG.rpcUrl) throw new Error(`unexpected fetch ${url}`);
    const request: unknown = JSON.parse(String(init?.body));
    const { method, params } = request as { method: string; params: unknown[] }; // hook-ok: test fixture
    if (method === "getBalance") {
      return jsonResponse(rpcBody(chain.lamports ?? 0, chain.slots?.balance ?? 4242));
    }
    const programId = (params[1] as { programId: string }).programId; // hook-ok: test fixture
    if (programId === TOKENKEG) {
      return jsonResponse(rpcBody(chain.splToken ?? [], chain.slots?.splToken ?? 4242));
    }
    if (programId === TOKEN_2022) {
      return jsonResponse(rpcBody(chain.token2022 ?? [], chain.slots?.token2022 ?? 4242));
    }
    throw new Error(`unexpected RPC ${method}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calledUrls(fetchMock: ReturnType<typeof vi.fn<FetchFn>>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

describe("parseNativeBalanceResponse", () => {
  test("reads the lamports and the slot", () => {
    expect(parseNativeBalanceResponse(rpcBody(RENT_LAMPORTS, 7))).toMatchObject({
      success: true,
      data: { slot: 7, value: BigInt(RENT_LAMPORTS) },
    });
  });

  test("an empty account is 0, not unavailable", () => {
    expect(parseNativeBalanceResponse(rpcBody(0))).toMatchObject({
      success: true,
      data: { value: BigInt(0) },
    });
  });

  test.each([
    ["a JSON-RPC error", { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }],
    ["a negative balance", rpcBody(-1)],
    ["a fractional balance", rpcBody(1.5)],
    ["a missing balance", rpcBody(undefined)],
    ["no context slot", { jsonrpc: "2.0", id: 1, result: { value: 1 } }],
    ["a non-object body", "garbage"],
  ])("fails closed on %s", (_label, body) => {
    expect(parseNativeBalanceResponse(body)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });
});

describe("parseTokenAccountsResponse", () => {
  const SPL = { vaultAddress: VAULT, program: "spl-token" as Program };

  test("no token accounts is an empty list, not unavailable", () => {
    expect(parseTokenAccountsResponse(rpcBody([]), SPL)).toMatchObject({
      success: true,
      data: { value: [] },
    });
  });

  test("reads every account's mint, decimals and amount", () => {
    const result = parseTokenAccountsResponse(
      rpcBody([
        tokenAccount({ amount: "1500000" }),
        tokenAccount({ amount: "3", mint: USDC_MINT }),
      ]),
      SPL,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        value: [
          { mint: BRS_MINT, decimals: 6, amount: BigInt(1_500_000) },
          { mint: USDC_MINT, decimals: 6, amount: BigInt(3) },
        ],
      },
    });
  });

  test("accepts Token-2022 accounts from the Token-2022 query", () => {
    const result = parseTokenAccountsResponse(
      rpcBody([tokenAccount({ amount: "1", program: "spl-token-2022" })]),
      { vaultAddress: VAULT, program: "spl-token-2022" },
    );
    expect(result.success).toBe(true);
  });

  test.each([
    ["a JSON-RPC error", { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }],
    ["no account list", rpcBody(null)],
    ["a wrong owner", rpcBody([tokenAccount({ amount: "1", owner: "SomeoneElse" })])],
    [
      "another program's account",
      rpcBody([tokenAccount({ amount: "1", program: "spl-token-2022" })]),
    ],
    ["a non-token program", rpcBody([tokenAccount({ amount: "1", program: "system" })])],
    ["a non-integer amount", rpcBody([tokenAccount({ amount: "1.5" })])],
    ["a negative amount", rpcBody([tokenAccount({ amount: "-1" })])],
    ["missing decimals", rpcBody([{ account: { data: { program: "spl-token" } } }])],
    ["a non-object body", "garbage"],
  ])("fails closed on %s", (_label, body) => {
    expect(parseTokenAccountsResponse(body, SPL)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });
});

describe("assembleHoldings", () => {
  const registry = reserveAssetRegistry(BRS_MINT);

  test("sums several accounts of one mint and lists unknown mints", () => {
    const result = assembleHoldings({
      lamports: BigInt(5),
      tokenAccounts: [
        {
          program: "spl-token",
          accounts: [
            { mint: BRS_MINT, decimals: 6, amount: BigInt(1_000_000) },
            { mint: BRS_MINT, decimals: 6, amount: BigInt(500_000) },
          ],
        },
        {
          program: "spl-token-2022",
          accounts: [{ mint: UNKNOWN_MINT, decimals: 2, amount: BigInt(42) }],
        },
      ],
      registry,
    });
    expect(result).toEqual({
      success: true,
      data: [
        {
          mint: WSOL_MINT,
          symbol: "SOL",
          kind: "sol",
          tokenProgram: "native",
          decimals: 9,
          amountBaseUnits: BigInt(5),
        },
        {
          mint: BRS_MINT,
          symbol: "BRS",
          kind: "brl_stable",
          tokenProgram: "spl-token",
          decimals: 6,
          amountBaseUnits: BigInt(1_500_000),
        },
        {
          mint: UNKNOWN_MINT,
          symbol: null,
          kind: "unknown",
          tokenProgram: "spl-token-2022",
          decimals: 2,
          amountBaseUnits: BigInt(42),
        },
      ],
      message: expect.any(String),
    });
  });

  test("fails closed when a known mint reports other decimals", () => {
    const result = assembleHoldings({
      lamports: BigInt(0),
      tokenAccounts: [
        { program: "spl-token", accounts: [{ mint: BRS_MINT, decimals: 9, amount: BigInt(1) }] },
      ],
      registry,
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });
});

describe("readSquadsCapacity (mocked network)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("SOL only (the vault today): SOL shown with its BRL value, counted balance 0", async () => {
    stubNetwork({ lamports: RENT_LAMPORTS }, { ptax: 5, solUsd: 150 });
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toEqual({
      success: true,
      data: {
        balanceBaseUnits: BigInt(0),
        requiredCoverageRatioBps: 2_500,
        source: { kind: "squads_multisig", vaultAddress: VAULT, slot: 4242 },
        holdings: [
          {
            mint: WSOL_MINT,
            symbol: "SOL",
            kind: "sol",
            tokenProgram: "native",
            decimals: 9,
            amountBaseUnits: "2039280",
            // 0.00203928 SOL × US$150 × R$5 = R$1.529…
            valueCents: 152,
            counted: false,
          },
        ],
        prices: {
          usdBrl: { rate: 5, source: "BCB_PTAX_VENDA", quotedAt: "2026-10-30 13:09:27" },
          solUsd: { price: 150, source: "JUPITER_PRICE_V3" },
        },
        usdStablesUncounted: false,
      },
      message: expect.any(String),
    });
  });

  test("an empty vault is a 0 balance with no price lookups", async () => {
    const fetchMock = stubNetwork({ lamports: 0 });
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toMatchObject({
      success: true,
      data: {
        balanceBaseUnits: BigInt(0),
        holdings: [{ symbol: "SOL", amountBaseUnits: "0", valueCents: null, counted: false }],
        prices: { usdBrl: null, solUsd: null },
        usdStablesUncounted: false,
      },
    });
    expect(calledUrls(fetchMock).every((url) => url === CONFIG.rpcUrl)).toBe(true);
  });

  test("BRS + SOL: BRS counts 1:1, SOL does not", async () => {
    stubNetwork(
      { lamports: 1_000_000_000, splToken: [tokenAccount({ amount: "50000000000" })] },
      { ptax: 5, solUsd: 150 },
    );
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toMatchObject({
      success: true,
      data: {
        balanceBaseUnits: BigInt(50_000_000_000),
        holdings: [
          { symbol: "SOL", valueCents: 75_000, counted: false },
          { symbol: "BRS", amountBaseUnits: "50000000000", valueCents: 5_000_000, counted: true },
        ],
      },
    });
  });

  test("BRS + USDC + SOL: USDC counts at PTAX", async () => {
    stubNetwork(
      {
        lamports: RENT_LAMPORTS,
        splToken: [
          tokenAccount({ amount: "50000000000" }),
          tokenAccount({ amount: "1000000000", mint: USDC_MINT }),
        ],
      },
      { ptax: 5.4321, solUsd: 150 },
    );
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toMatchObject({
      success: true,
      data: {
        // 50 000 BRS + 1 000 USDC × 5.4321 = R$ 55 432.10
        balanceBaseUnits: BigInt(55_432_100_000),
        holdings: [
          { symbol: "SOL", counted: false },
          { symbol: "BRS", valueCents: 5_000_000, counted: true },
          { symbol: "USDC", kind: "usd_stable", valueCents: 543_210, counted: true },
        ],
        usdStablesUncounted: false,
      },
    });
  });

  test("an unknown mint is listed, unpriced and not counted", async () => {
    stubNetwork(
      {
        splToken: [tokenAccount({ amount: "7000000" })],
        token2022: [
          tokenAccount({
            amount: "999",
            mint: UNKNOWN_MINT,
            decimals: 0,
            program: "spl-token-2022",
          }),
        ],
      },
      { ptax: 5, solUsd: 150 },
    );
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toMatchObject({
      success: true,
      data: {
        balanceBaseUnits: BigInt(7_000_000),
        holdings: [
          { symbol: "SOL" },
          { symbol: "BRS", counted: true },
          {
            mint: UNKNOWN_MINT,
            symbol: null,
            kind: "unknown",
            tokenProgram: "spl-token-2022",
            amountBaseUnits: "999",
            valueCents: null,
            counted: false,
          },
        ],
      },
    });
  });

  test("PTAX unavailable: USD stables shown but not counted, and the reading says so", async () => {
    stubNetwork(
      {
        lamports: RENT_LAMPORTS,
        splToken: [
          tokenAccount({ amount: "2000000" }),
          tokenAccount({ amount: "1000000", mint: USDC_MINT }),
        ],
      },
      { ptax: "down", solUsd: 150 },
    );
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toMatchObject({
      success: true,
      data: {
        balanceBaseUnits: BigInt(2_000_000),
        holdings: [
          { symbol: "SOL", valueCents: null, counted: false },
          { symbol: "BRS", counted: true },
          { symbol: "USDC", amountBaseUnits: "1000000", valueCents: null, counted: false },
        ],
        prices: { usdBrl: null, solUsd: { price: 150 } },
        usdStablesUncounted: true,
      },
    });
  });

  test("Jupiter unavailable: SOL shown without a BRL value; the snapshot still reads", async () => {
    stubNetwork(
      {
        lamports: RENT_LAMPORTS,
        splToken: [tokenAccount({ amount: "1000000", mint: USDC_MINT })],
      },
      { ptax: 5, solUsd: "down" },
    );
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toMatchObject({
      success: true,
      data: {
        balanceBaseUnits: BigInt(5_000_000),
        holdings: [
          { symbol: "SOL", valueCents: null, counted: false },
          { symbol: "USDC", valueCents: 500, counted: true },
        ],
        prices: { usdBrl: { rate: 5 }, solUsd: null },
      },
    });
  });

  test("a BRS-only vault fetches no price", async () => {
    const fetchMock = stubNetwork({ splToken: [tokenAccount({ amount: "1" })] });
    await readSquadsCapacity(CONFIG);
    expect(calledUrls(fetchMock).every((url) => url === CONFIG.rpcUrl)).toBe(true);
  });

  test("reports the oldest slot among its reads", async () => {
    stubNetwork({ slots: { balance: 300, splToken: 299, token2022: 301 } });
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({
      success: true,
      data: { source: { slot: 299 } },
    });
  });

  test("asks for native SOL and both token programs at finalized commitment", async () => {
    const fetchMock = stubNetwork({});
    await readSquadsCapacity(CONFIG);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [VAULT, { commitment: "finalized" }],
      },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          VAULT,
          { programId: TOKENKEG },
          { commitment: "finalized", encoding: "jsonParsed" },
        ],
      },
      {
        jsonrpc: "2.0",
        id: 1,
        method: "getTokenAccountsByOwner",
        params: [
          VAULT,
          { programId: TOKEN_2022 },
          { commitment: "finalized", encoding: "jsonParsed" },
        ],
      },
    ]);
  });

  test("fails closed on an RPC HTTP error, and asks for no price", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 429));
    vi.stubGlobal("fetch", fetchMock);
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
    expect(calledUrls(fetchMock).every((url) => url === CONFIG.rpcUrl)).toBe(true);
  });

  test("fails closed on a JSON-RPC error in one of the reads", async () => {
    const fetchMock = vi.fn<FetchFn>(async (_input, init) => {
      const { method } = JSON.parse(String(init?.body)) as { method: string }; // hook-ok: test fixture
      if (method === "getBalance") return jsonResponse(rpcBody(1));
      return jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "busy" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({ success: false });
  });

  test("fails closed when the body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>bad gateway</html>")),
    );
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({ success: false });
  });

  test("fails closed when the request throws, and never logs the RPC URL's API key", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error(`request to ${CONFIG.rpcUrl} failed`)),
    );
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(API_KEY);
    expect(JSON.stringify(errorLog.mock.calls)).toContain("rpc.test.invalid");
  });

  test("never puts the RPC URL in the reading", async () => {
    stubNetwork({ lamports: 1, splToken: [tokenAccount({ amount: "1" })] }, { ptax: 5, solUsd: 1 });
    const result = await readSquadsCapacity(CONFIG);
    expect(
      JSON.stringify(result, (_k, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(API_KEY);
  });
});

describe("squadsReserveReader", () => {
  const ENV_KEYS = ["SOLANA_RPC_URL", "RESERVE_SQUADS_VAULT_ADDRESS", "RESERVE_BRS_MINT"] as const;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    delete process.env.RESERVE_BRS_MINT;
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  test.each([["SOLANA_RPC_URL"], ["RESERVE_SQUADS_VAULT_ADDRESS"]] as const)(
    "is unavailable — without touching the network — until %s is set",
    async (missing) => {
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchMock);
      process.env.SOLANA_RPC_URL = CONFIG.rpcUrl;
      process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
      delete process.env[missing];
      expect(await squadsReserveReader.readCapacity()).toMatchObject({
        success: false,
        error: { code: "RESERVE_READER_UNAVAILABLE" },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("labels the mainnet BRS mint without any mint setting", async () => {
    stubNetwork({ splToken: [tokenAccount({ amount: "7" })] });
    process.env.SOLANA_RPC_URL = CONFIG.rpcUrl;
    process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
    expect(await squadsReserveReader.readCapacity()).toMatchObject({
      success: true,
      data: { balanceBaseUnits: BigInt(7), holdings: [{}, { symbol: "BRS", counted: true }] },
    });
  });

  test("RESERVE_BRS_MINT points the registry at the devnet mint", async () => {
    stubNetwork({
      splToken: [tokenAccount({ amount: "7", mint: BRS_DEVNET_MINT })],
    });
    process.env.SOLANA_RPC_URL = CONFIG.rpcUrl;
    process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
    process.env.RESERVE_BRS_MINT = BRS_DEVNET_MINT;
    expect(await squadsReserveReader.readCapacity()).toMatchObject({
      success: true,
      data: {
        balanceBaseUnits: BigInt(7),
        holdings: [{}, { mint: BRS_DEVNET_MINT, symbol: "BRS", counted: true }],
      },
    });
  });

  test("verifyRegistration is not available in phase 1", async () => {
    const result = await squadsReserveReader.verifyRegistration("sig", {
      idHex: "00",
      defaultCoverBaseUnits: BigInt(0),
      exitCoverBaseUnits: BigInt(0),
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });
});
