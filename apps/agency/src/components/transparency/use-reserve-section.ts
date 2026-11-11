"use client";

import { useLocale } from "next-intl";
import type { ReserveHealthReading } from "@convex/transparency/domain";
import { formatBRLCents, formatDateTimeBRT } from "@mutav/i18n/brazil";
import { formatMultiple, formatPercent } from "@mutav/ui/transparency/format";
import {
  formatHoldingAmount,
  holdingLabel,
  holdingShare,
  reserveSectionView,
  totalHoldingsValueCents,
  type CoverageState,
  type ReserveAccountView,
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
  /** Slice of the priced total as a percent; null when unpriced. */
  share: string | null;
  /** The same slice as 0..1, for the share bar. */
  shareFraction: number;
  counted: boolean;
  kind: "sol" | "brl_stable" | "usd_stable" | "unknown";
};

export type ReserveSectionModel =
  | { status: "loading" }
  | { status: "unavailable"; account: ReserveAccountView | null }
  | {
      status: "available";
      countedBalance: string;
      requiredCoverage: string;
      /** The pilot coverage ratio `c` as a percent, e.g. "25,0%". */
      requiredRatio: string;
      achievedCoverageRatio: string | null;
      coverageState: CoverageState;
      freeCapital: string;
      capturedAt: string;
      account: ReserveAccountView;
      rows: ReserveHoldingRow[];
      /** Σ priced holdings, counted or not. */
      holdingsTotal: string;
      /** "100%" in the locale's format, or null when nothing is priced (an empty or unpriced vault). */
      holdingsShare: string | null;
      usdStablesUncounted: boolean;
    };

export function useReserveSection(
  reading: ReserveHealthReading | null | undefined,
): ReserveSectionModel {
  const locale = useLocale();
  const view = reserveSectionView(reading);
  if (view.status !== "available") return view;
  const health = view.reading;
  const totalCents = totalHoldingsValueCents(health.holdings);
  return {
    status: "available",
    countedBalance: formatBRLCents(health.balanceCents),
    requiredCoverage: formatBRLCents(health.requiredCoverageCents),
    requiredRatio: formatPercent(locale, health.requiredCoverageRatioBps / BPS_DENOMINATOR),
    achievedCoverageRatio:
      health.achievedCoverageRatio === null
        ? null
        : formatMultiple(locale, health.achievedCoverageRatio),
    coverageState: view.coverageState,
    freeCapital: formatBRLCents(health.freeCapitalCents),
    capturedAt: formatDateTimeBRT(new Date(health.capturedAt).toISOString()),
    account: view.account,
    rows: health.holdings.map((holding) => {
      const share = holdingShare({ valueCents: holding.valueCents, totalCents });
      return {
        key: `${holding.tokenProgram}:${holding.mint}`,
        label: holdingLabel(holding),
        mint: holding.mint,
        known: holding.symbol !== null,
        amount: formatHoldingAmount(holding, locale),
        value: holding.valueCents === null ? null : formatBRLCents(holding.valueCents),
        share: share === null ? null : formatPercent(locale, share),
        shareFraction: share ?? 0,
        counted: holding.counted,
        kind: holding.kind,
      };
    }),
    holdingsTotal: formatBRLCents(totalCents),
    holdingsShare: totalCents > 0 ? formatPercent(locale, 1) : null,
    usdStablesUncounted: health.usdStablesUncounted,
  };
}
