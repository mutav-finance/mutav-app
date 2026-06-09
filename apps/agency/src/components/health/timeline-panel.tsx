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

type Period = "d30" | "d60" | "d90";
type Props = { timeline: HealthTimeline | null };

const PERIOD_VALUES = ["d30", "d60", "d90"] as const;
function isPeriod(v: string): v is Period {
  return (PERIOD_VALUES as readonly string[]).includes(v);
}

// Mock weekly data (13 weeks back from 2026-06-09) — replace with real platform-wide
// aggregates in production (issue #52)
const ALL_WEEKLY_DATA = [
  { week: "2026-03-11", newContracts: 8 },
  { week: "2026-03-18", newContracts: 10 },
  { week: "2026-03-25", newContracts: 9 },
  { week: "2026-04-01", newContracts: 7 },
  { week: "2026-04-08", newContracts: 5 },
  { week: "2026-04-15", newContracts: 5 },
  { week: "2026-04-22", newContracts: 6 },
  { week: "2026-04-29", newContracts: 4 },
  { week: "2026-05-06", newContracts: 4 },
  { week: "2026-05-13", newContracts: 3 },
  { week: "2026-05-20", newContracts: 3 },
  { week: "2026-05-27", newContracts: 4 },
  { week: "2026-06-03", newContracts: 3 },
];

const PERIOD_WEEKS: Record<Period, number> = { d30: 4, d60: 8, d90: 13 };

export function TimelinePanel({ timeline }: Props) {
  const t = useTranslations("health.timeline");
  const locale = useLocale();
  const [period, setPeriod] = React.useState<Period>("d30");

  const chartConfig: ChartConfig = {
    newContracts: {
      label: t("seriesNew"),
      color: "var(--color-chart-3)",
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
    return slice.reduce<{ week: string; newContracts: number; cumulativeContracts: number }[]>(
      (acc, entry) => {
        const prev = acc[acc.length - 1]?.cumulativeContracts ?? 0;
        return [...acc, { ...entry, cumulativeContracts: prev + entry.newContracts }];
      },
      [],
    );
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
              value="d30"
              className="data-[state=on]:border-amber-500 data-[state=on]:bg-amber-500 data-[state=on]:text-white"
            >
              {t("d30")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="d60"
              className="data-[state=on]:border-amber-500 data-[state=on]:bg-amber-500 data-[state=on]:text-white"
            >
              {t("d60")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="d90"
              className="data-[state=on]:border-amber-500 data-[state=on]:bg-amber-500 data-[state=on]:text-white"
            >
              {t("d90")}
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
              dataKey="newContracts"
              fill="var(--color-newContracts)"
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
