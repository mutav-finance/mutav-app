"use client";

import * as React from "react";
import { TrendingUpIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import type {
  ActivityGranularity,
  GuaranteeState,
  StateTimelineBucket,
} from "@convex/guarantees/domain";
import { GUARANTEE_STATES } from "@convex/guarantees/domain";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mutav/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@mutav/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Skeleton } from "@mutav/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import {
  GUARANTEE_STATE_CHART_COLOR,
  GUARANTEE_STATE_FILL_OPACITY,
} from "@/components/guarantees/state-chart-palette";
import {
  GUARANTEE_STATE_STACK_ORDER,
  buildStateLegend,
  sliceRecentPeriods,
  toChartRows,
  type GuaranteeStateCounts,
} from "@/lib/guarantees/state-chart";

export type GuaranteeStateChartRangeOption = {
  value: string;
  periods: number;
  labelKey: string;
};

type GuaranteeStateChartProps = {
  timeline: StateTimelineBucket[] | null | undefined;
  counts: GuaranteeStateCounts | null | undefined;
  granularity: ActivityGranularity;
  rangeOptions: readonly GuaranteeStateChartRangeOption[];
  defaultRange: string;
  i18nNamespace: string;
  showTrendIcon?: boolean;
};

const CHART_STACK_ID = "book";

function parsePeriodToDate(period: string, granularity: ActivityGranularity): Date {
  if (granularity === "month") {
    const [year, month] = period.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }
  const [year, month, day] = period.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The guarantee book in one card: how its composition moved (stacked bands,
 * one per lifecycle state) and where it stands right now (the legend, which
 * carries each state's current count).
 *
 * Stacked **area**, not stacked bars: the series is a stock, not a set of
 * events — a guarantee is in some state continuously, so the filled silhouette
 * IS the book and its height is the figure a reader wants. Interpolation is
 * `linear` rather than a spline so no band is ever drawn above or below a
 * count that was actually observed.
 */
export function GuaranteeStateChart({
  timeline,
  counts,
  granularity,
  rangeOptions,
  defaultRange,
  i18nNamespace,
  showTrendIcon = false,
}: GuaranteeStateChartProps) {
  const t = useTranslations(i18nNamespace);
  const tState = useTranslations("guaranteeDetails.state");
  const locale = useLocale();
  const [range, setRange] = React.useState<string>(defaultRange);

  const activeOption =
    rangeOptions.find((option) => option.value === range) ?? rangeOptions[rangeOptions.length - 1];

  const chartData = React.useMemo(
    () => toChartRows(sliceRecentPeriods(timeline, activeOption?.periods ?? 0)),
    [timeline, activeOption?.periods],
  );

  const legend = buildStateLegend(counts);

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

  const chartConfig: ChartConfig = Object.fromEntries(
    GUARANTEE_STATES.map((state) => [
      state,
      { label: tState(state), color: GUARANTEE_STATE_CHART_COLOR[state] },
    ]),
  );

  const isLoading = timeline === null || timeline === undefined;

  return (
    <Card className="@container/card">
      <CardHeader>
        {showTrendIcon ? (
          <CardDescription className="flex items-center gap-1.5">
            <TrendingUpIcon className="size-3.5" />
            {t("descriptionLong")}
          </CardDescription>
        ) : (
          <CardDescription>
            <span className="hidden @[540px]/card:block">{t("descriptionLong")}</span>
            <span className="@[540px]/card:hidden">{t("descriptionShort")}</span>
          </CardDescription>
        )}
        <CardTitle>{t("title")}</CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            value={range}
            onValueChange={(value) => value && setRange(value)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            {rangeOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={range} onValueChange={(value) => setRange(value)}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label={t("selectRangeAriaLabel")}
            >
              <SelectValue placeholder={activeOption ? t(activeOption.labelKey) : undefined} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {rangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 px-2 pt-4 sm:px-6 sm:pt-6">
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={[...chartData]}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="period"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={tickFormatter}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
                width={32}
              />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent labelFormatter={labelFormatter} indicator="dot" />}
              />
              {GUARANTEE_STATE_STACK_ORDER.map((state) => (
                <Area
                  key={state}
                  dataKey={state}
                  stackId={CHART_STACK_ID}
                  type="linear"
                  fill={`var(--color-${state})`}
                  fillOpacity={GUARANTEE_STATE_FILL_OPACITY[state]}
                  stroke={`var(--color-${state})`}
                  strokeWidth={1}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}
        <StateLegend entries={legend} label={t("legendLabel")} labelFor={tState} />
      </CardContent>
    </Card>
  );
}

function StateLegend({
  entries,
  label,
  labelFor,
}: {
  entries: ReturnType<typeof buildStateLegend>;
  label: string;
  labelFor: (state: GuaranteeState) => string;
}) {
  const countOf = new Map(entries?.map((entry) => [entry.state, entry.count]));

  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
      {GUARANTEE_STATES.map((state) => {
        const count = countOf.get(state);
        return (
          <div key={state} className="flex flex-col items-start gap-1">
            <dt className="text-muted-foreground flex items-center gap-2 text-xs">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: GUARANTEE_STATE_CHART_COLOR[state],
                  opacity: GUARANTEE_STATE_FILL_OPACITY[state],
                }}
              />
              {labelFor(state)}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {count === undefined ? <Skeleton className="h-8 w-8" /> : count}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
