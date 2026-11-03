import type { Result } from "../lib/result";
import { getReserveBrsMint, getReserveSquadsVaultAddress, getSolanaRpcUrl } from "../lib/env";
import { logError } from "../lib/logger";
import { BRS_DECIMALS, PILOT_COVERAGE_RATIO_BPS, RESERVE_SOURCE_KIND } from "./health";
// Type-only: `./reader` imports this adapter as a value, so a value import back would be a cycle.
import type { ReadCapacityError, ReserveCapacity, ReserveReader } from "./reader";

/**
 * Phase-1 reserve adapter (ADR 0012): the BRS balance of a Squads multisig
 * vault, read with one Solana JSON-RPC call over plain `fetch` at finalized
 * commitment. Holds no keys and signs nothing. Fails closed — any RPC error,
 * a vault with no BRS token account, an account for another mint or owner,
 * or unexpected decimals is `RESERVE_READER_UNAVAILABLE`.
 */

const UNAVAILABLE: ReadCapacityError["code"] = "RESERVE_READER_UNAVAILABLE";
const RPC_TIMEOUT_MS = 10_000;
const SPL_TOKEN_PROGRAMS: readonly string[] = ["spl-token", "spl-token-2022"];
const DIGITS_ONLY = /^\d+$/;

export type SquadsReserveConfig = { rpcUrl: string; vaultAddress: string; mint: string };

type ReadCapacityResult = Result<ReserveCapacity, ReadCapacityError>;
type ParsedVaultBalance = { balanceBaseUnits: bigint; slot: number };

function unavailable(message: string): {
  success: false;
  error: ReadCapacityError;
  message: string;
} {
  return { success: false, error: { code: UNAVAILABLE }, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/**
 * One token account from a `jsonParsed` response, checked against the vault
 * and mint we asked for. The RPC already filters by mint; checking again
 * keeps a misbehaving endpoint from passing another token off as BRS.
 */
function parseTokenAccount(
  entry: unknown,
  config: SquadsReserveConfig,
): Result<{ amount: bigint }, ReadCapacityError> {
  const data = field(field(entry, "account"), "data");
  const program = field(data, "program");
  const info = field(field(data, "parsed"), "info");
  const tokenAmount = field(info, "tokenAmount");
  const mint = field(info, "mint");
  const owner = field(info, "owner");
  const decimals = field(tokenAmount, "decimals");
  const amount = field(tokenAmount, "amount");

  if (typeof program !== "string" || !SPL_TOKEN_PROGRAMS.includes(program)) {
    return unavailable("Token account is not an SPL token account");
  }
  if (mint !== config.mint) return unavailable("Token account holds the wrong mint");
  if (owner !== config.vaultAddress) return unavailable("Token account is not owned by the vault");
  if (decimals !== BRS_DECIMALS) {
    return unavailable(
      `Token account reports ${String(decimals)} decimals; BRS has ${BRS_DECIMALS}`,
    );
  }
  if (typeof amount !== "string" || !DIGITS_ONLY.test(amount)) {
    return unavailable("Token account amount is not an unsigned integer");
  }
  return { success: true, data: { amount: BigInt(amount) }, message: "Token account parsed" };
}

/** A `getTokenAccountsByOwner` JSON-RPC response body → the vault's summed BRS balance. */
export function parseVaultBalanceResponse(
  body: unknown,
  config: SquadsReserveConfig,
): Result<ParsedVaultBalance, ReadCapacityError> {
  if (field(body, "error") !== undefined) return unavailable("RPC returned an error");
  const result = field(body, "result");
  const slot = field(field(result, "context"), "slot");
  const accounts = field(result, "value");
  if (typeof slot !== "number" || !Number.isInteger(slot)) {
    return unavailable("RPC response has no context slot");
  }
  if (!Array.isArray(accounts)) return unavailable("RPC response has no account list");
  if (accounts.length === 0) return unavailable("The vault holds no BRS token account");

  let balanceBaseUnits = BigInt(0);
  for (const entry of accounts) {
    const parsed = parseTokenAccount(entry, config);
    if (!parsed.success) return parsed;
    balanceBaseUnits += parsed.data.amount;
  }
  return { success: true, data: { balanceBaseUnits, slot }, message: "Vault balance read" };
}

async function fetchVaultBalance(config: SquadsReserveConfig): Promise<unknown> {
  const response = await fetch(config.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        config.vaultAddress,
        { mint: config.mint },
        { commitment: "finalized", encoding: "jsonParsed" },
      ],
    }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Solana RPC ${response.status} ${response.statusText}`);
  return await response.json();
}

export async function readSquadsCapacity(config: SquadsReserveConfig): Promise<ReadCapacityResult> {
  let body: unknown;
  try {
    body = await fetchVaultBalance(config);
  } catch (err) {
    logError("[reserve] Squads vault read failed", { error: err });
    return unavailable("Solana RPC request failed");
  }
  const parsed = parseVaultBalanceResponse(body, config);
  if (!parsed.success) {
    logError("[reserve] Squads vault read refused", { reason: parsed.message });
    return parsed;
  }
  return {
    success: true,
    data: {
      balanceBaseUnits: parsed.data.balanceBaseUnits,
      coverageRatioBps: PILOT_COVERAGE_RATIO_BPS,
      source: {
        kind: RESERVE_SOURCE_KIND.SQUADS_MULTISIG,
        vaultAddress: config.vaultAddress,
        mint: config.mint,
        slot: parsed.data.slot,
      },
    },
    message: "Reserve capacity read from the Squads vault",
  };
}

export function squadsReserveConfig(): SquadsReserveConfig | null {
  const rpcUrl = getSolanaRpcUrl();
  const vaultAddress = getReserveSquadsVaultAddress();
  const mint = getReserveBrsMint();
  if (!rpcUrl || !vaultAddress || !mint) return null;
  return { rpcUrl, vaultAddress, mint };
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
