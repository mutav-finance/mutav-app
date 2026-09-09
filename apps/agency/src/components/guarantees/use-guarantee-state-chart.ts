"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  GUARANTEE_EVENTS,
  type ActivityGranularity,
  type GuaranteeEvent,
  type GuaranteeState,
  type StateTimelineBucket,
} from "@convex/guarantees/domain";
import type { ChartConfig } from "@mutav/ui/chart";
import {
  GUARANTEE_EVENT_CHART_COLOR,
  IN_FORCE_AREA_COLOR,
} from "@/components/guarantees/state-chart-palette";
import {
  axisUpperBound,
  buildContextFigures,
  buildStateLegend,
  maxInForce,
  sliceRecentPeriods,
  toChartRows,
  toInForceRows,
  type GuaranteeStateCounts,
} from "@/lib/guarantees/state-chart";

export type GuaranteeStateChartRangeOption = {
  value: string;
  periods: number;
  labelKey: string;
};

type UseGuaranteeStateChartArgs = {
  timeline: StateTimelineBucket[] | null | undefined;
  counts: GuaranteeStateCounts | null | undefined;
  /** Tooltip name for the single plotted series; the caller owns the namespace. */
  inForceLabel: string;
  granularity: ActivityGranularity;
  rangeOptions: readonly GuaranteeStateChartRangeOption[];
  defaultRange: string;
};

function parsePeriodToDate(period: string, granularity: ActivityGranularity): Date {
  if (granularity === "month") {
    const [year, month] = period.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }
  const [year, month, day] = period.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function useGuaranteeStateChart({
  timeline,
  counts,
  inForceLabel,
  granularity,
  rangeOptions,
  defaultRange,
}: UseGuaranteeStateChartArgs) {
  const tState = useTranslations("guaranteeDetails.state");
  const tEvent = useTranslations("guaranteeEvents");
  const locale = useLocale();
  const [range, setRange] = React.useState<string>(defaultRange);

  const activeOption =
    rangeOptions.find((option) => option.value === range) ?? rangeOptions[rangeOptions.length - 1];

  const visibleBuckets = React.useMemo(
    () => sliceRecentPeriods(timeline, activeOption?.periods ?? 0),
    [timeline, activeOption?.periods],
  );

  const chartRows = React.useMemo(() => toChartRows(visibleBuckets), [visibleBuckets]);

  // One domain for the whole plot, set by the book. Bars are read against the
  // same scale as the area on purpose: a month with two events out of a book
  // of two hundred IS small, and a second axis would hide that.
  const axisMax = axisUpperBound(maxInForce(toInForceRows(visibleBuckets)));

  const formatter = React.useMemo(() => {
    if (granularity === "month") {
      return new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" });
    }
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  }, [granularity, locale]);

  const tickFormatter = React.useCallback(
    (value: string) => formatter.format(parsePeriodToDate(value, granularity)),
    [formatter, granularity],
  );

  const labelFormatter = React.useCallback(
    (value: unknown) => formatter.format(parsePeriodToDate(String(value), granularity)),
    [formatter, granularity],
  );

  const chartConfig: ChartConfig = {
    inForce: { label: inForceLabel, color: IN_FORCE_AREA_COLOR },
    ...Object.fromEntries(
      GUARANTEE_EVENTS.map((event) => [
        event,
        { label: tEvent(event), color: GUARANTEE_EVENT_CHART_COLOR[event] },
      ]),
    ),
  };

  return {
    range,
    setRange,
    activeOption,
    chartRows,
    axisMax,
    legend: buildStateLegend(counts),
    contextFigures: buildContextFigures(counts),
    chartConfig,
    tickFormatter,
    labelFormatter,
    stateLabel: (state: GuaranteeState) => tState(state),
    eventLabel: (event: GuaranteeEvent) => tEvent(event),
    isLoading: timeline === null || timeline === undefined,
  };
}
