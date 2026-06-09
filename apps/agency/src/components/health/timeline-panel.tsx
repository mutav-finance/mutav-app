"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { TrendingUpIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { HealthTimeline } from "@convex/health/domain";

type Period = "d30" | "d90" | "d180";
type Props = { timeline: HealthTimeline | null };

export function TimelinePanel({ timeline }: Props) {
  const t = useTranslations("health.timeline");
  const [period, setPeriod] = React.useState<Period>("d30");

  const loading = timeline === null;
  const count = timeline ? timeline[period].newContracts : null;

  const PERIODS: { key: Period; label: string }[] = [
    { key: "d30", label: t("d30") },
    { key: "d90", label: t("d90") },
    { key: "d180", label: t("d180") },
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <TrendingUpIcon className="size-3.5" />
          {t("label")}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? <Skeleton className="h-8 w-12" /> : count}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-1">
          {PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                period === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground mt-2 text-xs">{t("description")}</p>
      </CardContent>
    </Card>
  );
}
