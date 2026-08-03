"use node";

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  getBcbPtaxBaseUrl,
  getReserveBrlPeggedSymbols,
  getReserveContractId,
  getReserveUsdSymbols,
  getStellarNetwork,
  getStellarRpcUrl,
} from "../lib/env";
import { logError } from "../lib/logger";
import {
  storedValueCentsFromValuedAssets,
  valueAssets,
  type ReserveAsset,
  type ReserveReadResult,
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

async function readReserve(): Promise<ReserveReadResult> {
  const contractId = getReserveContractId();
  if (!contractId) return { available: false };

  try {
    // Fetch FX first: a failure here must yield `{ available: false }` (caught
    // below) so the snapshot is never written with a fabricated rate or value.
    const { rate: usdBrlRate, source: fxSource, quotedAt: fxQuotedAt } = await fetchPtaxUsdBrl();

    const server = new rpc.Server(getStellarRpcUrl(), { timeout: 10_000 });
    const networkPassphrase = getStellarNetwork() === "public" ? Networks.PUBLIC : Networks.TESTNET;
    const vault = new Contract(contractId);

    const rawAddresses = await simulateRead(
      server,
      vault,
      "approved_assets",
      [],
      networkPassphrase,
    );
    const addresses = Array.isArray(rawAddresses) ? rawAddresses.map(String) : [];

    const assets: ReserveAsset[] = [];
    for (const addr of addresses) {
      const token = new Contract(addr);
      const [rawBalance, symbol, decimals] = await Promise.all([
        simulateRead(
          server,
          vault,
          "balance",
          [Address.fromString(addr).toScVal()],
          networkPassphrase,
        ),
        simulateRead(server, token, "symbol", [], networkPassphrase),
        simulateRead(server, token, "decimals", [], networkPassphrase),
      ]);
      assets.push({
        contractAddress: addr,
        symbol: String(symbol),
        decimals: Number(decimals),
        rawBalance: String(rawBalance),
      });
    }

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
      capturedAt: Date.now(),
    });
  },
});
