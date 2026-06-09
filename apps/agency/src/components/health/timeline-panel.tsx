"use client";

import * as React from "react";
import { useTranslations, useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { TrendingUpIcon } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@mutav/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { Skeleton } from "@mutav/ui/skeleton";
import type { HealthTimeline } from "@convex/health/domain";

type Period = "m6" | "m12";
type Props = { timeline: HealthTimeline | null };

const PERIOD_VALUES = ["m6", "m12"] as const;
function isPeriod(v: string): v is Period {
  return (PERIOD_VALUES as readonly string[]).includes(v);
}

// Mock weekly data (52 weeks back from 2026-06-09) — replace with real platform-wide
// aggregates in production (issue #52)
const ALL_WEEKLY_DATA = [
  { week: "2025-06-04", activeContracts: 4, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-06-11", activeContracts: 5, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2025-06-18", activeContracts: 3, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2025-06-25", activeContracts: 6, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-07-02", activeContracts: 4, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2025-07-09", activeContracts: 5, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2025-07-16", activeContracts: 7, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2025-07-23", activeContracts: 6, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2025-07-30", activeContracts: 5, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2025-08-06", activeContracts: 6, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-08-13", activeContracts: 7, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-08-20", activeContracts: 8, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-08-27", activeContracts: 6, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-09-03", activeContracts: 7, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-09-10", activeContracts: 9, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-09-17", activeContracts: 8, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-09-24", activeContracts: 7, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-10-01", activeContracts: 9, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-10-08", activeContracts: 10, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-10-15", activeContracts: 8, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-10-22", activeContracts: 9, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-10-29", activeContracts: 11, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-11-05", activeContracts: 10, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-11-12", activeContracts: 9, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-11-19", activeContracts: 8, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-11-26", activeContracts: 7, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-12-03", activeContracts: 6, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-12-10", activeContracts: 5, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-12-17", activeContracts: 4, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2025-12-24", activeContracts: 3, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2025-12-31", activeContracts: 3, cancelledContracts: 0, delinquentContracts: 0 },
  { week: "2026-01-07", activeContracts: 5, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-01-14", activeContracts: 6, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-01-21", activeContracts: 7, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-01-28", activeContracts: 8, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-02-04", activeContracts: 9, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-02-11", activeContracts: 10, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-02-18", activeContracts: 9, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-02-25", activeContracts: 8, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-03-04", activeContracts: 9, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-03-11", activeContracts: 8, cancelledContracts: 1, delinquentContracts: 1 },
  { week: "2026-03-18", activeContracts: 10, cancelledContracts: 0, delinquentContracts: 2 },
  { week: "2026-03-25", activeContracts: 9, cancelledContracts: 2, delinquentContracts: 1 },
  { week: "2026-04-01", activeContracts: 7, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-04-08", activeContracts: 5, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-04-15", activeContracts: 5, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-04-22", activeContracts: 6, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-04-29", activeContracts: 4, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-05-06", activeContracts: 4, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-05-13", activeContracts: 3, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-05-20", activeContracts: 3, cancelledContracts: 0, delinquentContracts: 1 },
  { week: "2026-05-27", activeContracts: 4, cancelledContracts: 1, delinquentContracts: 0 },
  { week: "2026-06-03", activeContracts: 3, cancelledContracts: 0, delinquentContracts: 1 },
];

const PERIOD_WEEKS: Record<Period, number> = { m6: 26, m12: 52 };

export function TimelinePanel({ timeline }: Props) {
  const t = useTranslations("health.timeline");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<Period>("m6");

  const chartConfig: ChartConfig = {
    activeContracts: {
      label: t("seriesActive"),
      color: "var(--color-emerald-500)",
    },
    cancelledContracts: {
      label: t("seriesCancelled"),
      color: "var(--color-stone-400)",
    },
    delinquentContracts: {
      label: t("seriesDelinquent"),
      color: "var(--color-red-500)",
    },
    cumulativeContracts: {
      label: t("seriesCumulative"),
      color: "var(--color-chart-1)",
    },
  };

  const weekFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }),
    [locale],
  );

  const chartData = React.useMemo(() => {
    const slice = ALL_WEEKLY_DATA.slice(-PERIOD_WEEKS[period]);
    return slice.reduce<
      {
        week: string;
        activeContracts: number;
        cancelledContracts: number;
        delinquentContracts: number;
        cumulativeContracts: number;
      }[]
    >((acc, entry) => {
      const prev = acc[acc.length - 1]?.cumulativeContracts ?? 0;
      return [...acc, { ...entry, cumulativeContracts: prev + entry.activeContracts }];
    }, []);
  }, [period]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          <TrendingUpIcon className="size-3.5" />
          {t("description")}
        </CardDescription>
        <CardTitle>{t("label")}</CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => {
              if (isPeriod(v)) setPeriod(v);
            }}
            variant="outline"
            className="*:data-[slot=toggle-group-item]:px-4!"
          >
            <ToggleGroupItem
              value="m6"
              className="data-[state=on]:border-amber-500 data-[state=on]:text-amber-600"
            >
              {t("m6")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="m12"
              className="data-[state=on]:border-amber-500 data-[state=on]:text-amber-600"
            >
              {t("m12")}
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {timeline === null ? <Skeleton className="h-[250px] w-full" /> : null}
        <ChartContainer
          config={chartConfig}
          className={cn("aspect-auto h-[250px] w-full", timeline === null && "hidden")}
        >
          <ComposedChart data={chartData} barCategoryGap="20%" barGap={2}>
            <defs>
              <linearGradient id="fillCumulative" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-cumulativeContracts)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-cumulativeContracts)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="week"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value: string) => {
                const [year, month, day] = value.split("-");
                return weekFormatter.format(new Date(Number(year), Number(month) - 1, Number(day)));
              }}
            />
            <YAxis yAxisId="bars" hide />
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
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => {
                    const str = String(value);
                    const [year, month, day] = str.split("-");
                    return weekFormatter.format(
                      new Date(Number(year), Number(month) - 1, Number(day)),
                    );
                  }}
                  indicator="dot"
                />
              }
            />
            <Bar
              yAxisId="bars"
              dataKey="activeContracts"
              fill="var(--color-emerald-500)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              yAxisId="bars"
              dataKey="cancelledContracts"
              fill="var(--color-stone-400)"
              radius={[3, 3, 0, 0]}
            />
            <Bar
              yAxisId="bars"
              dataKey="delinquentContracts"
              fill="var(--color-red-500)"
              radius={[3, 3, 0, 0]}
            />
            <Area
              yAxisId="area"
              dataKey="cumulativeContracts"
              type="monotone"
              fill="url(#fillCumulative)"
              stroke="var(--color-cumulativeContracts)"
              strokeWidth={2}
              dot={false}
            />
            <ChartLegend content={<ChartLegendContent />} />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
