"use client";

import { useLocale } from "next-intl";
import type { ReserveHealthReading } from "@convex/transparency/domain";
import { formatBRLCents, formatDateTimeBRT } from "@mutav/i18n/brazil";
import { formatMultiple, formatPercent } from "@mutav/ui/transparency/format";
import {
  formatHoldingAmount,
  holdingLabel,
  reserveSectionView,
  type CoverageState,
} from "./reserve-view-model";

const BPS_DENOMINATOR = 10_000;

export type ReserveHoldingRow = {
  key: string;
  label: string;
  /** The full mint, shown under an unknown asset's short label. */
  mint: string;
  known: boolean;
  amount: string;
  /** Formatted BRL value; null when the asset is unpriced. */
  value: string | null;
  counted: boolean;
  kind: "sol" | "brl_stable" | "usd_stable" | "unknown";
};

export type ReserveSectionModel =
  | { status: "loading" }
  | { status: "unavailable"; vaultExplorerUrl: string | null }
  | {
      status: "available";
      countedBalance: string;
      requiredCoverage: string;
      /** The pilot coverage ratio `c` as a percent, e.g. "25,0%". */
      requiredRatio: string;
      coverageRatio: string | null;
      coverageState: CoverageState;
      freeCapital: string;
      capturedAt: string;
      vaultExplorerUrl: string;
      vaultAddress: string;
      rows: ReserveHoldingRow[];
      usdStablesUncounted: boolean;
    };

export function useReserveSection(
  reading: ReserveHealthReading | null | undefined,
): ReserveSectionModel {
  const locale = useLocale();
  const view = reserveSectionView(reading);
  if (view.status !== "available") return view;
  const health = view.reading;
  return {
    status: "available",
    countedBalance: formatBRLCents(health.balanceCents),
    requiredCoverage: formatBRLCents(health.requiredCoverageCents),
    requiredRatio: formatPercent(locale, health.coverageRatioBps / BPS_DENOMINATOR),
    coverageRatio:
      health.coverageRatio === null ? null : formatMultiple(locale, health.coverageRatio),
    coverageState: view.coverageState,
    freeCapital: formatBRLCents(health.freeCapitalCents),
    capturedAt: formatDateTimeBRT(new Date(health.capturedAt).toISOString()),
    vaultExplorerUrl: health.vaultExplorerUrl,
    vaultAddress: health.source.vaultAddress,
    rows: health.holdings.map((holding) => ({
      key: `${holding.tokenProgram}:${holding.mint}`,
      label: holdingLabel(holding),
      mint: holding.mint,
      known: holding.symbol !== null,
      amount: formatHoldingAmount(holding, locale),
      value: holding.valueCents === null ? null : formatBRLCents(holding.valueCents),
      counted: holding.counted,
      kind: holding.kind,
    })),
    usdStablesUncounted: health.usdStablesUncounted,
  };
}
