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
  GUARANTEE_STATE_CHART_COLOR,
} from "@/components/guarantees/state-chart-palette";
import {
  GUARANTEE_STATE_STACK_ORDER,
  axisUpperBound,
  buildContextFigures,
  buildStateLegend,
  hasAnyEvent,
  maxEventCount,
  maxStackedTotal,
  sliceRecentPeriods,
  toCompositionRows,
  toEventRows,
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

  const compositionRows = React.useMemo(() => toCompositionRows(visibleBuckets), [visibleBuckets]);
  const eventRows = React.useMemo(() => toEventRows(visibleBuckets), [visibleBuckets]);

  const compositionAxisMax = axisUpperBound(maxStackedTotal(compositionRows));
  // The event panel scales to its own data. Borrowing the area's domain is
  // what left every bar at 1 inside a 0-4 axis: three quarters dead space.
  const eventPeak = maxEventCount(eventRows);
  const eventAxisMax = Math.max(1, eventPeak);

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

  const compositionConfig: ChartConfig = Object.fromEntries(
    GUARANTEE_STATE_STACK_ORDER.map((state) => [
      state,
      { label: tState(state), color: GUARANTEE_STATE_CHART_COLOR[state] },
    ]),
  );

  const eventConfig: ChartConfig = Object.fromEntries(
    GUARANTEE_EVENTS.map((event) => [
      event,
      { label: tEvent(event), color: GUARANTEE_EVENT_CHART_COLOR[event] },
    ]),
  );

  return {
    range,
    setRange,
    activeOption,
    compositionRows,
    eventRows,
    hasEvents: hasAnyEvent(eventRows),
    compositionAxisMax,
    eventAxisMax,
    eventTickCount: Math.min(eventAxisMax + 1, 5),
    legend: buildStateLegend(counts),
    contextFigures: buildContextFigures(counts),
    compositionConfig,
    eventConfig,
    tickFormatter,
    labelFormatter,
    stateLabel: (state: GuaranteeState) => tState(state),
    eventLabel: (event: GuaranteeEvent) => tEvent(event),
    isLoading: timeline === null || timeline === undefined,
  };
}
