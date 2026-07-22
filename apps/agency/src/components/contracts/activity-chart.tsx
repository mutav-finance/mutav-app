"use client";

import * as React from "react";
import { TrendingUpIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import type { ActivityBucket, ActivityGranularity } from "@convex/contracts/domain";
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
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@mutav/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Skeleton } from "@mutav/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";

export type ActivityChartRangeOption = {
  value: string;
  periods: number;
  labelKey: string;
};

type ActivityChartProps = {
  data: ActivityBucket[] | null | undefined;
  granularity: ActivityGranularity;
  rangeOptions: ActivityChartRangeOption[];
  defaultRange: string;
  i18nNamespace: string;
  showTrendIcon?: boolean;
};

function parsePeriodToDate(period: string, granularity: ActivityGranularity): Date {
  if (granularity === "month") {
    const [year, month] = period.split("-").map(Number);
    return new Date(year, month - 1, 1);
  }
  const [year, month, day] = period.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function ActivityChart({
  data,
  granularity,
  rangeOptions,
  defaultRange,
  i18nNamespace,
  showTrendIcon = false,
}: ActivityChartProps) {
  const t = useTranslations(i18nNamespace);
  const locale = useLocale();
  const [range, setRange] = React.useState<string>(defaultRange);

  const activeOption =
    rangeOptions.find((o) => o.value === range) ?? rangeOptions[rangeOptions.length - 1];

  const chartData = React.useMemo(() => {
    if (!data) return [];
    return data.slice(-activeOption.periods);
  }, [data, activeOption.periods]);

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

  const chartConfig = {
    activated: {
      label: t("series.activated"),
      color: "var(--color-chart-3)",
    },
    cancelled: {
      label: t("series.canceled"),
      color: "var(--color-chart-4)",
    },
    expired: {
      label: t("series.expired"),
      color: "var(--color-chart-5)",
    },
    netActive: {
      label: t("series.netActive"),
      color: "var(--color-chart-1)",
    },
  } satisfies ChartConfig;

  const isLoading = data === null || data === undefined;

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
            onValueChange={(v) => v && setRange(v)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            {rangeOptions.map((opt) => (
              <ToggleGroupItem key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={range} onValueChange={(v) => setRange(v)}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label={t("selectRangeAriaLabel")}
            >
              <SelectValue placeholder={t(activeOption.labelKey)} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {rangeOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <ComposedChart data={chartData} barCategoryGap="20%" barGap={2}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="period"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={tickFormatter}
              />
              <YAxis
                yAxisId="bars"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
                width={24}
              />
              <YAxis
                yAxisId="area"
                orientation="right"
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
              <Bar
                yAxisId="bars"
                dataKey="activated"
                fill="var(--color-activated)"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                yAxisId="bars"
                dataKey="cancelled"
                fill="var(--color-cancelled)"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                yAxisId="bars"
                dataKey="expired"
                fill="var(--color-expired)"
                radius={[3, 3, 0, 0]}
              />
              <Area
                yAxisId="area"
                dataKey="netActive"
                type="monotone"
                fill="var(--color-netActive)"
                fillOpacity={0.15}
                stroke="var(--color-netActive)"
                strokeWidth={2}
                dot={false}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
