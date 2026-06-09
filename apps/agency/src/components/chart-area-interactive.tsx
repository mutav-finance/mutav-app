"use client";

import * as React from "react";
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useLocale, useTranslations } from "next-intl";
import { useWorkspace } from "@/providers/workspace";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";

export const description = "Contratos ativos sob gestão por mês";

export function ChartAreaInteractive() {
  const t = useTranslations("chart");
  const locale = useLocale();
  const { selectedAgency } = useWorkspace();

  const rawData = useQuery(
    api.contracts.useCases.countByMonth,
    selectedAgency ? { agencyId: selectedAgency._id } : "skip",
  );

  const [timeRange, setTimeRange] = React.useState<"6m" | "12m">("12m");

  const monthFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", year: "2-digit" }),
    [locale],
  );

  const chartData = React.useMemo(() => {
    if (!rawData) return [];
    const cutoff = timeRange === "6m" ? 6 : 12;
    return rawData.slice(-cutoff);
  }, [rawData, timeRange]);

  const chartConfig = {
    netActive: {
      label: t("series.netActive"),
      color: "var(--color-chart-1)",
    },
    activated: {
      label: t("series.activated"),
      color: "var(--color-chart-3)",
    },
    cancelled: {
      label: t("series.cancelled"),
      color: "var(--color-chart-4)",
    },
    expired: {
      label: t("series.expired"),
      color: "var(--color-chart-5)",
    },
  } satisfies ChartConfig;

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">{t("descriptionLong")}</span>
          <span className="@[540px]/card:hidden">{t("descriptionShort")}</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={(v) => v && setTimeRange(v as "6m" | "12m")}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="6m">{t("last6Months")}</ToggleGroupItem>
            <ToggleGroupItem value="12m">{t("last12Months")}</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as "6m" | "12m")}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label={t("selectRangeAriaLabel")}
            >
              <SelectValue placeholder={t("last12Months")} />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="6m">{t("last6Months")}</SelectItem>
              <SelectItem value="12m">{t("last12Months")}</SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
          <ComposedChart data={chartData} barCategoryGap="20%" barGap={2}>
            <defs>
              <linearGradient id="fillNetActive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--color-netActive)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--color-netActive)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value: string) => {
                const [year, month] = value.split("-");
                return monthFormatter.format(new Date(Number(year), Number(month) - 1, 1));
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
                    const [year, month] = str.split("-");
                    return monthFormatter.format(new Date(Number(year), Number(month) - 1, 1));
                  }}
                  indicator="dot"
                />
              }
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
              fill="url(#fillNetActive)"
              stroke="var(--color-netActive)"
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
