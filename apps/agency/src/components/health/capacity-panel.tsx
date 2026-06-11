"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { ContractAggregates } from "@convex/health/domain";

type Props = { aggregates: ContractAggregates | null };

export function CapacityPanel({ aggregates }: Props) {
  const t = useTranslations("health.capacity");
  const loading = aggregates === null;

  const utilizationPct =
    aggregates && aggregates.maxCapacityCents > 0
      ? Math.min((aggregates.sumInsuredCents / aggregates.maxCapacityCents) * 100, 100)
      : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{t("label")}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? <Skeleton className="h-8 w-16" /> : `${utilizationPct.toFixed(1)}%`}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <Skeleton className="h-3 w-full rounded-full" />
        ) : (
          <div className="bg-muted h-3 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-amber-500 transition-all duration-500"
              style={{ width: `${utilizationPct.toFixed(1)}%` }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
