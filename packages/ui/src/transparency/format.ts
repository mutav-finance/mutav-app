// BRL figures and timestamps are not formatted here: they go through the
// pt-BR formatters in `@mutav/i18n/brazil` in every locale, so the transparency
// and treasury panels read "R$ 1.234,56" / "29/09/2026" like the rest of the
// app. Only the language-agnostic figures below follow the active locale.

// Amounts are labelled with the vault's own token symbol, never a currency
// style: the reserve settles in a testnet mock (cUSD), and an `Intl` currency
// format would dress it up as real US dollars.
export function formatAssetAmount(locale: string, amount: number, symbol: string): string {
  const figure = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${figure} ${symbol}`;
}

export function formatMultiple(locale: string, ratio: number): string {
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ratio)}×`;
}

export function formatPercent(locale: string, fraction: number): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction);
}
