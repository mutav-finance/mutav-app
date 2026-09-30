"use node";

import {
  Account,
  BASE_FEE,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  getBcbPtaxBaseUrl,
  getReserveBrlPeggedSymbols,
  getReserveContractId,
  getReservePolicyContractId,
  getReserveRegistryContractId,
  getReserveUsdSymbols,
  getStellarNetwork,
  getStellarRpcUrl,
} from "../lib/env";
import { logError } from "../lib/logger";
import {
  RESERVE_POSITION_KIND,
  findCoverageRatioBps,
  parseStrategyAllocations,
  storedValueCentsFromValuedAssets,
  valueAssets,
  type ReserveAsset,
  type ReserveReadResult,
  type ReserveSolvencySnapshot,
} from "./domain";

type PtaxQuote = { cotacaoCompra?: number; cotacaoVenda?: number; dataHoraCotacao?: string };
type PtaxResponse = { value?: PtaxQuote[] };

// BCB PTAX OData requires the US month-day-year order in the date filter.
function ptaxDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getUTCFullYear()}`;
}

async function fetchPtaxUsdBrl(): Promise<{ rate: number; source: string; quotedAt: string }> {
  const now = new Date();
  const start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const url =
    `${getBcbPtaxBaseUrl()}/CotacaoDolarPeriodo(dataInicial=@di,dataFinalCotacao=@df)` +
    `?@di='${ptaxDate(start)}'&@df='${ptaxDate(now)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`PTAX ${res.status} ${res.statusText}`);
  const data = (await res.json()) as PtaxResponse; // hook-ok: external BCB PTAX API response
  const quote = data.value?.[0];
  const rate = quote?.cotacaoVenda;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
    throw new Error("PTAX: invalid venda rate");
  const quotedAt = (quote?.dataHoraCotacao ?? "").slice(0, 19);
  return { rate, source: "BCB_PTAX_VENDA", quotedAt };
}

// Canonical all-zero account — valid for read-only simulation (never signed).
// Derived rather than hand-typed so the strkey checksum is always correct.
const SIMULATION_SOURCE = StrKey.encodeEd25519PublicKey(Buffer.alloc(32));

async function simulateRead(
  server: rpc.Server,
  contract: Contract,
  method: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
): Promise<unknown> {
  const source = new Account(SIMULATION_SOURCE, "0");
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  if (!sim.result?.retval) throw new Error(`${method}: empty retval`);
  return scValToNative(sim.result.retval);
}

// An i128/u32 read comes back from `scValToNative` as bigint or number; anything
// else means the contract answered with a shape we don't understand.
function integerString(value: unknown, method: string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  throw new Error(`${method}: expected an integer, got ${typeof value}`);
}

type PulseReserveIds = { vaultId: string; policyId: string; registryId: string };

/**
 * One solvency read of the mutav-pulse reserve, entirely by simulation (read
 * only — nothing is ever signed or submitted). The policy has no getter for
 * its coverage ratio `c`, so that one value comes from its instance storage.
 */
async function readPulseSolvency(
  server: rpc.Server,
  networkPassphrase: string,
  ids: PulseReserveIds,
): Promise<ReserveSolvencySnapshot> {
  const vault = new Contract(ids.vaultId);
  const policy = new Contract(ids.policyId);
  const registry = new Contract(ids.registryId);
  const read = (contract: Contract, method: string) =>
    simulateRead(server, contract, method, [], networkPassphrase);

  const [totalAssets, stableAssets, freeCapital, idle, rawStrategies, assetId] = await Promise.all([
    read(vault, "total_assets"),
    read(vault, "stable_assets"),
    read(vault, "free_capital"),
    read(vault, "available_held"),
    read(vault, "strategies"),
    read(vault, "query_asset"),
  ]);
  const [coverageRequired, rawCoverage, policyInstance] = await Promise.all([
    read(policy, "coverage_required"),
    read(registry, "raw_coverage"),
    server.getContractData(ids.policyId, xdr.ScVal.scvLedgerKeyContractInstance()),
  ]);

  const strategies = parseStrategyAllocations(rawStrategies);
  if (!strategies) throw new Error("strategies: unexpected shape");
  const storage = policyInstance.val.contractData().val().instance().storage() ?? [];
  const coverageRatioBps = findCoverageRatioBps(
    storage.map((entry) => ({
      key: scValToNative(entry.key()),
      val: scValToNative(entry.val()),
    })),
  );
  if (coverageRatioBps === null) throw new Error("policy: CoverageRatioBps not found");

  const asset = new Contract(String(assetId));
  const [symbol, decimals, ...strategyBalances] = await Promise.all([
    read(asset, "symbol"),
    read(asset, "decimals"),
    ...strategies.map((s) => read(new Contract(s.address), "balance")),
  ]);

  return {
    ...ids,
    assetContractId: String(assetId),
    assetSymbol: String(symbol),
    assetDecimals: Number(integerString(decimals, "decimals")),
    totalAssetsRaw: integerString(totalAssets, "total_assets"),
    stableAssetsRaw: integerString(stableAssets, "stable_assets"),
    freeCapitalRaw: integerString(freeCapital, "free_capital"),
    coverageRequiredRaw: integerString(coverageRequired, "coverage_required"),
    rawCoverageRaw: integerString(rawCoverage, "raw_coverage"),
    coverageRatioBps,
    positions: [
      {
        kind: RESERVE_POSITION_KIND.IDLE,
        address: ids.vaultId,
        volatile: false,
        rawBalance: integerString(idle, "available_held"),
      },
      ...strategies.map((s, i) => ({
        kind: RESERVE_POSITION_KIND.STRATEGY,
        address: s.address,
        volatile: s.volatile,
        rawBalance: integerString(strategyBalances[i], "balance"),
      })),
    ],
  };
}

function pulseReserveIds(): PulseReserveIds | null {
  const vaultId = getReserveContractId();
  const policyId = getReservePolicyContractId();
  const registryId = getReserveRegistryContractId();
  if (!vaultId || !policyId || !registryId) return null;
  return { vaultId, policyId, registryId };
}

async function readReserve(): Promise<ReserveReadResult> {
  const ids = pulseReserveIds();
  if (!ids) return { available: false };

  try {
    // Fetch FX first: a failure here must yield `{ available: false }` (caught
    // below) so the snapshot is never written with a fabricated rate or value.
    const { rate: usdBrlRate, source: fxSource, quotedAt: fxQuotedAt } = await fetchPtaxUsdBrl();

    const server = new rpc.Server(getStellarRpcUrl(), { timeout: 10_000 });
    const networkPassphrase = getStellarNetwork() === "public" ? Networks.PUBLIC : Networks.TESTNET;
    const solvency = await readPulseSolvency(server, networkPassphrase, ids);

    // The vault holds a single underlying; its total_assets (idle + every
    // strategy) is the one asset row the BRL-indicative headline is priced from.
    const assets: ReserveAsset[] = [
      {
        contractAddress: solvency.assetContractId,
        symbol: solvency.assetSymbol,
        decimals: solvency.assetDecimals,
        rawBalance: solvency.totalAssetsRaw,
      },
    ];
    const pricing = {
      brlSymbols: getReserveBrlPeggedSymbols(),
      usdSymbols: getReserveUsdSymbols(),
      usdBrlRate,
    };
    const valued = valueAssets(assets, pricing);
    const storedValueCents = storedValueCentsFromValuedAssets(valued);
    return {
      available: true,
      storedValueCents,
      fxUsdBrl: usdBrlRate,
      fxSource,
      fxQuotedAt,
      assets: valued,
      solvency,
    };
  } catch (err) {
    // Non-fatal: keep the last good snapshot, report unavailable, never a mock.
    // Logged so operators can see a persistently broken read.
    logError("[reserve] RPC read failed — snapshot not updated", { error: err });
    return { available: false };
  }
}

export const refreshReserveSnapshot = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const result = await readReserve();
    if (!result.available) return; // keep the last good snapshot; write nothing
    await ctx.runMutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: result.storedValueCents,
      fxUsdBrl: result.fxUsdBrl,
      fxSource: result.fxSource,
      fxQuotedAt: result.fxQuotedAt,
      assets: result.assets,
      solvency: result.solvency,
      capturedAt: Date.now(),
    });
  },
});
