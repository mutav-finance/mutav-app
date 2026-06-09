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
const PERIOD_WEEKS: Record<Period, number> = { m6: 26, m12: 52 };

function isPeriod(v: string): v is Period {
  return (PERIOD_VALUES as readonly string[]).includes(v);
}

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
    if (!timeline) return [];
    const slice = timeline.slice(-PERIOD_WEEKS[period]);
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
      return [
        ...acc,
        {
          week: entry.weekStartISO,
          activeContracts: entry.activeContracts,
          cancelledContracts: entry.cancelledContracts,
          delinquentContracts: entry.delinquentContracts,
          cumulativeContracts: prev + entry.activeContracts,
        },
      ];
    }, []);
  }, [period, timeline]);

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
