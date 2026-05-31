/**
 * BRL spot rates for supported Stellar assets. Reads CoinGecko's free
 * public endpoint and caches via Next's data cache (30s revalidation —
 * at most one upstream call per region every 30s, regardless of traffic).
 *
 * Fallback path returns NaN per missing symbol; callers should default to
 * the registry's static `brlPerUnit` when this hook errors.
 *
 * Server-only — relies on Next's fetch cache. Do not import from client
 * components.
 */

const COINGECKO_ID: Record<string, string> = {
  XLM: "stellar",
  USDC: "usd-coin",
};

const FEED_URL = "https://api.coingecko.com/api/v3/simple/price";
const REVALIDATE_SECONDS = 30;

export type BrlRates = Record<string, number | undefined>;

export async function getBrlRates(symbols: readonly string[]): Promise<BrlRates> {
  const ids = symbols
    .map((s) => COINGECKO_ID[s])
    .filter((id): id is string => Boolean(id))
    .join(",");
  if (!ids) return {};

  const url = `${FEED_URL}?ids=${ids}&vs_currencies=brl`;
  try {
    const response = await fetch(url, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!response.ok) return {};
    const data = (await response.json()) as Record<string, { brl?: number }>;
    return Object.fromEntries(
      symbols.map((symbol) => {
        const cgId = COINGECKO_ID[symbol];
        const rate = cgId ? data[cgId]?.brl : undefined;
        return [symbol, rate];
      }),
    );
  } catch {
    return {};
  }
}
