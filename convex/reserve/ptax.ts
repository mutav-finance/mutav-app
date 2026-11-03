import { getBcbPtaxBaseUrl } from "../lib/env";

/**
 * The BCB PTAX USD/BRL reference rate (venda leg), shared by the Stellar
 * reserve snapshot and the phase-1 Squads health snapshot. Throws on any
 * failure; each caller decides whether a missing rate fails its read.
 */

export type PtaxQuote = { rate: number; source: string; quotedAt: string };

type PtaxRow = { cotacaoCompra?: number; cotacaoVenda?: number; dataHoraCotacao?: string };
type PtaxResponse = { value?: PtaxRow[] };

export const PTAX_SOURCE = "BCB_PTAX_VENDA";
const PTAX_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const PTAX_TIMEOUT_MS = 8_000;

// BCB PTAX OData requires the US month-day-year order in the date filter.
function ptaxDate(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getUTCFullYear()}`;
}

export async function fetchPtaxUsdBrl(): Promise<PtaxQuote> {
  const now = new Date();
  const start = new Date(now.getTime() - PTAX_LOOKBACK_MS);
  const url =
    `${getBcbPtaxBaseUrl()}/CotacaoDolarPeriodo(dataInicial=@di,dataFinalCotacao=@df)` +
    `?@di='${ptaxDate(start)}'&@df='${ptaxDate(now)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(PTAX_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`PTAX ${res.status} ${res.statusText}`);
  const data = (await res.json()) as PtaxResponse; // hook-ok: external BCB PTAX API response
  const quote = data.value?.[0];
  const rate = quote?.cotacaoVenda;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
    throw new Error("PTAX: invalid venda rate");
  const quotedAt = (quote?.dataHoraCotacao ?? "").slice(0, 19);
  return { rate, source: PTAX_SOURCE, quotedAt };
}
