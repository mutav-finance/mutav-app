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
  getFxUsdBrlUrl,
  getReserveBrlPeggedSymbols,
  getReserveContractId,
  getReserveUsdSymbols,
  getStellarNetwork,
  getStellarRpcUrl,
} from "../lib/env";
import {
  storedValueCentsFromValuedAssets,
  valueAssets,
  type ReserveAsset,
  type ReserveReadResult,
} from "./domain";

type FxResponse = { rates?: { BRL?: number } };

async function fetchUsdBrlRate(): Promise<number> {
  const res = await fetch(getFxUsdBrlUrl(), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`FX ${res.status} ${res.statusText}`);
  const data = (await res.json()) as FxResponse; // hook-ok: external FX API response
  const rate = data.rates?.BRL;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
    throw new Error("FX: invalid BRL rate");
  return rate;
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
    const usdBrlRate = await fetchUsdBrlRate();

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
    return { available: true, storedValueCents, fxUsdBrl: usdBrlRate, assets: valued };
  } catch (err) {
    // Non-fatal: keep the last good snapshot, report unavailable, never a mock.
    // Logged so operators can see a persistently broken read.
    console.error("[reserve] RPC read failed — snapshot not updated:", err);
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
      assets: result.assets,
      capturedAt: Date.now(),
    });
  },
});
