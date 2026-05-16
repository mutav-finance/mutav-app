import type { ResolvedAsset } from "@/lib/stellar/assets";

export type AssetAmount = {
  /** Canonical decimal string for the SEP-7 URI (dot decimal, no grouping). */
  canonical: string;
  /** Locale-formatted display value (with thousands separators). */
  display: string;
};

export function brlCentsToAsset(
  totalCents: number,
  asset: ResolvedAsset,
  locale: string,
): AssetAmount {
  const units = totalCents / 100 / asset.brlPerUnit;
  return {
    canonical: units.toFixed(asset.decimals),
    display: new Intl.NumberFormat(locale, {
      minimumFractionDigits: asset.displayDecimals,
      maximumFractionDigits: asset.displayDecimals,
      useGrouping: true,
    }).format(units),
  };
}
