import type { Result } from "../lib/result";
import { getReserveBrsMint, getReserveSquadsVaultAddress, getSolanaRpcUrl } from "../lib/env";
import { logError } from "../lib/logger";
import {
  BRS_MINT_MAINNET,
  findKnownAsset,
  RESERVE_ASSET_KIND,
  RESERVE_TOKEN_PROGRAM,
  reserveAssetRegistry,
  SOL_DECIMALS,
  SPL_TOKEN_PROGRAM_IDS,
  WRAPPED_SOL_MINT,
  type KnownReserveAsset,
} from "./assets";
import { PILOT_COVERAGE_RATIO_BPS, RESERVE_SOURCE_KIND } from "./health";
import { readReservePrices } from "./prices";
import { valueReserveHoldings, type ReserveHolding } from "./valuation";
// Type-only: `./reader` imports this adapter as a value, so a value import back would be a cycle.
import type { ReadCapacityError, ReserveCapacity, ReserveReader } from "./reader";

/**
 * Phase-1 reserve adapter (ADR 0012): every holding of a Squads multisig
 * vault — native SOL plus each token account under the SPL Token and
 * Token-2022 programs — read over plain `fetch` JSON-RPC at finalized
 * commitment. Holds no keys and signs nothing.
 *
 * An empty vault, or one with no token accounts, is a balance of 0. Any RPC
 * error, a malformed response, an account owned by someone else, or a known
 * mint reporting the wrong decimals fails closed: `RESERVE_READER_UNAVAILABLE`.
 * Prices are fetched after the chain read and fail soft (see `./prices`).
 *
 * The RPC URL carries an API key: it is never logged or stored — only its host.
 */

const UNAVAILABLE: ReadCapacityError["code"] = "RESERVE_READER_UNAVAILABLE";
const RPC_TIMEOUT_MS = 10_000;
const DIGITS_ONLY = /^\d+$/;
const MAX_TOKEN_DECIMALS = 255;

export type SquadsReserveConfig = { rpcUrl: string; vaultAddress: string; brsMint: string };

type SplTokenProgram =
  | typeof RESERVE_TOKEN_PROGRAM.SPL_TOKEN
  | typeof RESERVE_TOKEN_PROGRAM.SPL_TOKEN_2022;

const SPL_TOKEN_PROGRAMS: readonly SplTokenProgram[] = [
  RESERVE_TOKEN_PROGRAM.SPL_TOKEN,
  RESERVE_TOKEN_PROGRAM.SPL_TOKEN_2022,
];

type ReadFailure = { success: false; error: ReadCapacityError; message: string };
type SlotValue<T> = { slot: number; value: T };
export type VaultHoldings = { holdings: ReserveHolding[]; slot: number };

function unavailable(message: string): ReadFailure {
  return { success: false, error: { code: UNAVAILABLE }, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** The `{ context: { slot }, value }` envelope every RPC answer here shares. */
function parseEnvelope(body: unknown): Result<SlotValue<unknown>, ReadCapacityError> {
  if (!isRecord(body)) return unavailable("RPC response is not an object");
  if (body.error !== undefined) return unavailable("RPC returned an error");
  const result = body.result;
  const slot = field(field(result, "context"), "slot");
  if (typeof slot !== "number" || !Number.isInteger(slot)) {
    return unavailable("RPC response has no context slot");
  }
  return {
    success: true,
    data: { slot, value: field(result, "value") },
    message: "Envelope parsed",
  };
}

/** A `getBalance` body → the vault's lamports. */
export function parseNativeBalanceResponse(
  body: unknown,
): Result<SlotValue<bigint>, ReadCapacityError> {
  const envelope = parseEnvelope(body);
  if (!envelope.success) return envelope;
  const lamports = envelope.data.value;
  if (typeof lamports !== "number" || !Number.isSafeInteger(lamports) || lamports < 0) {
    return unavailable("RPC balance is not a non-negative integer");
  }
  return {
    success: true,
    data: { slot: envelope.data.slot, value: BigInt(lamports) },
    message: "Native balance read",
  };
}

type TokenAccount = { mint: string; decimals: number; amount: bigint };

function parseTokenAccount(
  entry: unknown,
  { vaultAddress, program }: { vaultAddress: string; program: SplTokenProgram },
): Result<TokenAccount, ReadCapacityError> {
  const data = field(field(entry, "account"), "data");
  const info = field(field(data, "parsed"), "info");
  const tokenAmount = field(info, "tokenAmount");
  const mint = field(info, "mint");
  const decimals = field(tokenAmount, "decimals");
  const amount = field(tokenAmount, "amount");

  if (field(data, "program") !== program) {
    return unavailable(`Token account is not a ${program} account`);
  }
  if (typeof mint !== "string" || mint.length === 0)
    return unavailable("Token account has no mint");
  if (field(info, "owner") !== vaultAddress) {
    return unavailable("Token account is not owned by the vault");
  }
  if (
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > MAX_TOKEN_DECIMALS
  ) {
    return unavailable("Token account decimals are not a small unsigned integer");
  }
  if (typeof amount !== "string" || !DIGITS_ONLY.test(amount)) {
    return unavailable("Token account amount is not an unsigned integer");
  }
  return {
    success: true,
    data: { mint, decimals, amount: BigInt(amount) },
    message: "Token account parsed",
  };
}

/** A `getTokenAccountsByOwner` body (one token program) → the vault's token accounts. */
export function parseTokenAccountsResponse(
  body: unknown,
  { vaultAddress, program }: { vaultAddress: string; program: SplTokenProgram },
): Result<SlotValue<TokenAccount[]>, ReadCapacityError> {
  const envelope = parseEnvelope(body);
  if (!envelope.success) return envelope;
  const entries = envelope.data.value;
  if (!Array.isArray(entries)) return unavailable("RPC response has no account list");
  const accounts: TokenAccount[] = [];
  for (const entry of entries) {
    const parsed = parseTokenAccount(entry, { vaultAddress, program });
    if (!parsed.success) return parsed;
    accounts.push(parsed.data);
  }
  return {
    success: true,
    data: { slot: envelope.data.slot, value: accounts },
    message: "Token accounts parsed",
  };
}

function holdingFor({
  known,
  mint,
  tokenProgram,
  decimals,
}: {
  known: KnownReserveAsset | null;
  mint: string;
  tokenProgram: ReserveHolding["tokenProgram"];
  decimals: number;
}): ReserveHolding {
  return {
    mint,
    symbol: known?.symbol ?? null,
    kind: known?.kind ?? RESERVE_ASSET_KIND.UNKNOWN,
    tokenProgram,
    decimals,
    amountBaseUnits: BigInt(0),
  };
}

/**
 * Native lamports plus every token account → one holding per (program, mint),
 * labelled from the registry. Several accounts of one mint are summed. A
 * known mint reporting decimals other than the registry's fails closed: a
 * mis-scaled BRS balance would misstate the reserve by orders of magnitude.
 */
export function assembleHoldings({
  lamports,
  tokenAccounts,
  registry,
}: {
  lamports: bigint;
  tokenAccounts: { program: SplTokenProgram; accounts: readonly TokenAccount[] }[];
  registry: readonly KnownReserveAsset[];
}): Result<ReserveHolding[], ReadCapacityError> {
  const native = holdingFor({
    known: findKnownAsset(registry, WRAPPED_SOL_MINT),
    mint: WRAPPED_SOL_MINT,
    tokenProgram: RESERVE_TOKEN_PROGRAM.NATIVE,
    decimals: SOL_DECIMALS,
  });
  const holdings: ReserveHolding[] = [{ ...native, amountBaseUnits: lamports }];

  for (const { program, accounts } of tokenAccounts) {
    for (const account of accounts) {
      const known = findKnownAsset(registry, account.mint);
      if (known && known.decimals !== account.decimals) {
        return unavailable(
          `${known.symbol} account reports ${account.decimals} decimals; expected ${known.decimals}`,
        );
      }
      let holding = holdings.find((h) => h.mint === account.mint && h.tokenProgram === program);
      if (!holding) {
        holding = holdingFor({
          known,
          mint: account.mint,
          tokenProgram: program,
          decimals: account.decimals,
        });
        holdings.push(holding);
      }
      if (holding.decimals !== account.decimals) {
        return unavailable("Two accounts of one mint report different decimals");
      }
      holding.amountBaseUnits += account.amount;
    }
  }
  return { success: true, data: holdings, message: "Holdings assembled" };
}

function rpcHost(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    return "invalid-url";
  }
}

/** An error's message with the RPC URL (and its API key) cut out — the only form that is logged. */
function scrubbedReason(err: unknown, rpcUrl: string): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return message.split(rpcUrl).join("<rpc>");
}

async function rpcCall(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Solana RPC ${response.status} ${response.statusText}`);
  return await response.json();
}

const READ_OPTIONS = { commitment: "finalized" } as const;
const TOKEN_READ_OPTIONS = { commitment: "finalized", encoding: "jsonParsed" } as const;

/** The vault's holdings, chain only: one `getBalance` and one `getTokenAccountsByOwner` per token program. */
export async function readVaultHoldings(
  config: SquadsReserveConfig,
): Promise<Result<VaultHoldings, ReadCapacityError>> {
  let balanceBody: unknown;
  let tokenBodies: unknown[];
  try {
    [balanceBody, ...tokenBodies] = await Promise.all([
      rpcCall(config.rpcUrl, "getBalance", [config.vaultAddress, READ_OPTIONS]),
      ...SPL_TOKEN_PROGRAMS.map((program) =>
        rpcCall(config.rpcUrl, "getTokenAccountsByOwner", [
          config.vaultAddress,
          { programId: SPL_TOKEN_PROGRAM_IDS[program] },
          TOKEN_READ_OPTIONS,
        ]),
      ),
    ]);
  } catch (err) {
    logError("[reserve] Squads vault read failed", {
      rpcHost: rpcHost(config.rpcUrl),
      reason: scrubbedReason(err, config.rpcUrl),
    });
    return unavailable("Solana RPC request failed");
  }

  const refuse = (reason: string): ReadFailure => {
    logError("[reserve] Squads vault read refused", { rpcHost: rpcHost(config.rpcUrl), reason });
    return unavailable(reason);
  };

  const native = parseNativeBalanceResponse(balanceBody);
  if (!native.success) return refuse(native.message);

  const slots = [native.data.slot];
  const tokenAccounts: { program: SplTokenProgram; accounts: TokenAccount[] }[] = [];
  for (const [index, program] of SPL_TOKEN_PROGRAMS.entries()) {
    const parsed = parseTokenAccountsResponse(tokenBodies[index], {
      vaultAddress: config.vaultAddress,
      program,
    });
    if (!parsed.success) return refuse(parsed.message);
    slots.push(parsed.data.slot);
    tokenAccounts.push({ program, accounts: parsed.data.value });
  }

  const holdings = assembleHoldings({
    lamports: native.data.value,
    tokenAccounts,
    registry: reserveAssetRegistry(config.brsMint),
  });
  if (!holdings.success) return refuse(holdings.message);
  return {
    success: true,
    data: { holdings: holdings.data, slot: Math.min(...slots) },
    message: "Vault holdings read",
  };
}

function holds(holdings: readonly ReserveHolding[], kind: ReserveHolding["kind"]): boolean {
  return holdings.some((h) => h.kind === kind && h.amountBaseUnits > BigInt(0));
}

export async function readSquadsCapacity(
  config: SquadsReserveConfig,
): Promise<Result<ReserveCapacity, ReadCapacityError>> {
  const read = await readVaultHoldings(config);
  if (!read.success) return read;
  const { holdings, slot } = read.data;
  const prices = await readReservePrices({
    holdsUsdStables: holds(holdings, RESERVE_ASSET_KIND.USD_STABLE),
    holdsSol: holds(holdings, RESERVE_ASSET_KIND.SOL),
  });
  const valuation = valueReserveHoldings(holdings, prices);
  return {
    success: true,
    data: {
      balanceBaseUnits: valuation.countedBaseUnits,
      coverageRatioBps: PILOT_COVERAGE_RATIO_BPS,
      source: {
        kind: RESERVE_SOURCE_KIND.SQUADS_MULTISIG,
        vaultAddress: config.vaultAddress,
        slot,
      },
      holdings: valuation.holdings,
      prices,
      usdStablesUncounted: valuation.usdStablesUncounted,
    },
    message: "Reserve capacity read from the Squads vault",
  };
}

/** Needs the RPC URL and the vault; the BRS mint defaults to mainnet (`RESERVE_BRS_MINT` overrides it on devnet). */
export function squadsReserveConfig(): SquadsReserveConfig | null {
  const rpcUrl = getSolanaRpcUrl();
  const vaultAddress = getReserveSquadsVaultAddress();
  if (!rpcUrl || !vaultAddress) return null;
  return { rpcUrl, vaultAddress, brsMint: getReserveBrsMint() ?? BRS_MINT_MAINNET };
}

export const squadsReserveReader: ReserveReader = {
  async readCapacity() {
    const config = squadsReserveConfig();
    if (!config) return unavailable("The Squads reserve is not configured");
    return readSquadsCapacity(config);
  },
  async verifyRegistration() {
    return {
      success: false,
      error: { code: UNAVAILABLE },
      message: "Phase 1 has no reserve program to verify a registration against (ADR 0012)",
    };
  },
};
