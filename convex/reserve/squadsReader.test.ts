import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  parseVaultBalanceResponse,
  readSquadsCapacity,
  squadsReserveReader,
  type SquadsReserveConfig,
} from "./squadsReader";

const VAULT = "Vau1tSquadsPdaxxxxxxxxxxxxxxxxxxxxxxxxxxxx1";
const BRS_MINT = "BRSmintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1";
const OTHER_MINT = "USDCmintxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1";
const CONFIG: SquadsReserveConfig = {
  rpcUrl: "https://rpc.test.invalid",
  vaultAddress: VAULT,
  mint: BRS_MINT,
};

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

function rpcBody(accounts: unknown[], slot = 4242) {
  return { jsonrpc: "2.0", id: 1, result: { context: { slot }, value: accounts } };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseVaultBalanceResponse", () => {
  test("sums every BRS token account the vault owns", () => {
    const result = parseVaultBalanceResponse(
      rpcBody([tokenAccount({ amount: "1500000" }), tokenAccount({ amount: "250000000000" })]),
      CONFIG,
    );
    expect(result).toMatchObject({
      success: true,
      data: { balanceBaseUnits: BigInt("250001500000"), slot: 4242 },
    });
  });

  test("accepts a Token-2022 account", () => {
    const result = parseVaultBalanceResponse(
      rpcBody([tokenAccount({ amount: "1", program: "spl-token-2022" })]),
      CONFIG,
    );
    expect(result.success).toBe(true);
  });

  test.each([
    ["a JSON-RPC error", { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "bad" } }],
    ["no token account (missing account)", rpcBody([])],
    ["a wrong mint", rpcBody([tokenAccount({ amount: "1", mint: OTHER_MINT })])],
    ["a wrong owner", rpcBody([tokenAccount({ amount: "1", owner: "SomeoneElse" })])],
    ["unexpected decimals", rpcBody([tokenAccount({ amount: "1", decimals: 9 })])],
    ["a non-token program", rpcBody([tokenAccount({ amount: "1", program: "system" })])],
    ["a non-integer amount", rpcBody([tokenAccount({ amount: "1.5" })])],
    ["a negative amount", rpcBody([tokenAccount({ amount: "-1" })])],
    ["no context slot", { jsonrpc: "2.0", id: 1, result: { value: [] } }],
    ["a non-object body", "garbage"],
  ])("fails closed on %s", (_label, body) => {
    expect(parseVaultBalanceResponse(body, CONFIG)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });

  test("one bad account fails the whole read, even beside a good one", () => {
    const result = parseVaultBalanceResponse(
      rpcBody([
        tokenAccount({ amount: "1000000" }),
        tokenAccount({ amount: "1", mint: OTHER_MINT }),
      ]),
      CONFIG,
    );
    expect(result.success).toBe(false);
  });
});

describe("readSquadsCapacity (mocked fetch)", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns the balance, pilot c and the source on a good read", async () => {
    fetchMock.mockResolvedValue(jsonResponse(rpcBody([tokenAccount({ amount: "2000000" })], 99)));
    const result = await readSquadsCapacity(CONFIG);
    expect(result).toEqual({
      success: true,
      data: {
        balanceBaseUnits: BigInt(2_000_000),
        coverageRatioBps: 2_500,
        source: { kind: "squads_multisig", vaultAddress: VAULT, mint: BRS_MINT, slot: 99 },
      },
      message: expect.any(String),
    });
  });

  test("asks for the vault's BRS accounts at finalized commitment", async () => {
    fetchMock.mockResolvedValue(jsonResponse(rpcBody([tokenAccount({ amount: "1" })])));
    await readSquadsCapacity(CONFIG);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(CONFIG.rpcUrl);
    expect(JSON.parse(String(init?.body))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [VAULT, { mint: BRS_MINT }, { commitment: "finalized", encoding: "jsonParsed" }],
    });
  });

  test("fails closed when the RPC answers with an HTTP error", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "rate limited" }, 429));
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });

  test("fails closed when the request throws (network down, timeout)", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });

  test("fails closed when the body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 200 }));
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({ success: false });
  });

  test("fails closed on a wrong mint from the RPC", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(rpcBody([tokenAccount({ amount: "5000000", mint: OTHER_MINT })])),
    );
    expect(await readSquadsCapacity(CONFIG)).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
  });
});

describe("squadsReserveReader", () => {
  const ENV_KEYS = ["SOLANA_RPC_URL", "RESERVE_SQUADS_VAULT_ADDRESS", "RESERVE_BRS_MINT"] as const;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
  });

  test("is unavailable — without touching the network — until all three settings exist", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    process.env.SOLANA_RPC_URL = CONFIG.rpcUrl;
    process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
    delete process.env.RESERVE_BRS_MINT;
    expect(await squadsReserveReader.readCapacity()).toMatchObject({
      success: false,
      error: { code: "RESERVE_READER_UNAVAILABLE" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reads through the configured vault", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(rpcBody([tokenAccount({ amount: "7" })]))),
    );
    process.env.SOLANA_RPC_URL = CONFIG.rpcUrl;
    process.env.RESERVE_SQUADS_VAULT_ADDRESS = VAULT;
    process.env.RESERVE_BRS_MINT = BRS_MINT;
    expect(await squadsReserveReader.readCapacity()).toMatchObject({
      success: true,
      data: { balanceBaseUnits: BigInt(7) },
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
