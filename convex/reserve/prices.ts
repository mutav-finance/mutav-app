import { logWarn } from "../lib/logger";
import { WRAPPED_SOL_MINT } from "./assets";
import { fetchPtaxUsdBrl, type PtaxQuote } from "./ptax";

/**
 * Prices for valuing the reserve's holdings in BRL. Both fail soft: a missing
 * price never blocks a snapshot. Without PTAX the USD stablecoins are shown
 * but not counted; without a SOL price, SOL is shown without a BRL value.
 */

export type SolUsdQuote = { price: number; source: string };

export type ReservePrices = {
  usdBrl: PtaxQuote | null;
  /** Display only — SOL never counts toward coverage. */
  solUsd: SolUsdQuote | null;
};

export const JUPITER_PRICE_SOURCE = "JUPITER_PRICE_V3";
const JUPITER_PRICE_URL = `https://lite-api.jup.ag/price/v3?ids=${WRAPPED_SOL_MINT}`;
const JUPITER_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A Jupiter Price API v3 body → SOL's USD price, or null when the shape or value is off. */
export function parseJupiterSolPrice(body: unknown): number | null {
  const entry = isRecord(body) ? body[WRAPPED_SOL_MINT] : undefined;
  const price = isRecord(entry) ? entry.usdPrice : undefined;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  return price;
}

async function fetchSolUsd(): Promise<SolUsdQuote | null> {
  try {
    const res = await fetch(JUPITER_PRICE_URL, { signal: AbortSignal.timeout(JUPITER_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Jupiter price ${res.status} ${res.statusText}`);
    const price = parseJupiterSolPrice(await res.json());
    if (price === null) throw new Error("Jupiter price: no usable SOL price");
    return { price, source: JUPITER_PRICE_SOURCE };
  } catch (err) {
    logWarn("[reserve] SOL price unavailable — SOL shown without a BRL value", { error: err });
    return null;
  }
}

async function fetchUsdBrl(): Promise<PtaxQuote | null> {
  try {
    return await fetchPtaxUsdBrl();
  } catch (err) {
    logWarn("[reserve] PTAX unavailable — USD holdings shown but not counted", { error: err });
    return null;
  }
}

/** Fetches only what the holdings need: nothing for a BRS-only vault. */
export async function readReservePrices({
  holdsUsdStables,
  holdsSol,
}: {
  holdsUsdStables: boolean;
  holdsSol: boolean;
}): Promise<ReservePrices> {
  const [usdBrl, solUsd] = await Promise.all([
    holdsUsdStables || holdsSol ? fetchUsdBrl() : Promise.resolve(null),
    holdsSol ? fetchSolUsd() : Promise.resolve(null),
  ]);
  return { usdBrl, solUsd };
}
