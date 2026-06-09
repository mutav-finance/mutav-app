"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import { formatBRLCents } from "@/lib/contracts/format";
import type { ContractAggregates } from "@convex/health/domain";

type Props = { aggregates: ContractAggregates | null };

export function CapacityPanel({ aggregates }: Props) {
  const t = useTranslations("health.capacity");
  const loading = aggregates === null;

  const utilizationPct =
    aggregates && aggregates.maxCapacityCents > 0
      ? Math.min((aggregates.sumInsuredCents / aggregates.maxCapacityCents) * 100, 100)
      : 0;

  const headroomCents = aggregates
    ? Math.max(aggregates.maxCapacityCents - aggregates.sumInsuredCents, 0)
    : 0;

  return (
    <Card className="@5xl/main:col-span-1">
      <CardHeader className="pb-2">
        <CardDescription>{t("label")}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? <Skeleton className="h-8 w-24" /> : formatBRLCents(headroomCents)}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <Skeleton className="h-3 w-full rounded-full" />
        ) : (
          <>
            <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                style={{ width: `${utilizationPct.toFixed(1)}%` }}
              />
            </div>
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>{t("used", { pct: utilizationPct.toFixed(1) })}</span>
              <span>{t("of", { total: formatBRLCents(aggregates?.maxCapacityCents ?? 0) })}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
