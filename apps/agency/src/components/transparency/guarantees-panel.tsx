"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlertTriangleIcon, ClockIcon, FileTextIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { cn } from "@mutav/ui/cn";
import { Skeleton } from "@mutav/ui/skeleton";
import type { GuaranteeAggregates } from "@convex/transparency/domain";
import { formatPercent } from "@mutav/ui/transparency/format";
import { InfoHint } from "./info-hint";

type Props = { aggregates: GuaranteeAggregates | null };

function MetricCard({
  icon,
  label,
  value,
  loading,
  hint,
  secondary = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  hint?: string;
  secondary?: boolean;
}) {
  return (
    <Card className={cn(secondary && "bg-transparent shadow-none")}>
      <CardHeader>
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
          {hint ? <InfoHint label={label} hint={hint} /> : null}
        </CardDescription>
        <CardTitle
          className={cn(
            "font-semibold tabular-nums",
            secondary ? "text-muted-foreground text-xl" : "text-2xl @[250px]/card:text-3xl",
          )}
        >
          {loading ? <Skeleton className="h-8 w-16" /> : value}
        </CardTitle>
      </CardHeader>
    </Card>
  );
}

/**
 * The risk read of the book: what is in force and the default rate. Drafts
 * trail as a secondary figure — they carry no risk until activated.
 */
export function GuaranteesPanel({ aggregates }: Props) {
  const t = useTranslations("transparency.guarantees");
  const locale = useLocale();
  const loading = aggregates === null;

  const defaultRatePct =
    aggregates && aggregates.defaultRate !== null
      ? formatPercent(locale, aggregates.defaultRate)
      : "—";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <MetricCard
        icon={<FileTextIcon className="size-3.5" />}
        label={t("insured")}
        value={String(aggregates?.countInsured ?? "—")}
        loading={loading}
      />
      <MetricCard
        icon={<AlertTriangleIcon className="size-3.5" />}
        label={t("defaultRate")}
        value={defaultRatePct}
        loading={loading}
        hint={t("defaultRateHint")}
      />
      <MetricCard
        secondary
        icon={<ClockIcon className="size-3.5" />}
        label={t("drafted")}
        value={String(aggregates?.countByState.drafted ?? "—")}
        loading={loading}
      />
    </div>
  );
}
