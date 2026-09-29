"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  ClockIcon,
  FileTextIcon,
  ShieldAlertIcon,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { GuaranteeAggregates } from "@convex/transparency/domain";
import { formatBRLCents } from "@mutav/i18n/brazil";
import { formatPercent } from "@mutav/ui/transparency/format";

type Props = { aggregates: GuaranteeAggregates | null };

function MetricCard({
  icon,
  label,
  value,
  loading,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {loading ? <Skeleton className="h-8 w-16" /> : value}
        </CardTitle>
      </CardHeader>
      {hint ? (
        <CardContent>
          <p className="text-muted-foreground text-xs">{hint}</p>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function GuaranteesPanel({ aggregates }: Props) {
  const t = useTranslations("transparency.guarantees");
  const locale = useLocale();
  const loading = aggregates === null;

  const defaultRatePct =
    aggregates && aggregates.defaultRate !== null
      ? formatPercent(locale, aggregates.defaultRate)
      : "—";

  return (
    <>
      <MetricCard
        icon={<FileTextIcon className="size-3.5" />}
        label={t("insured")}
        value={String(aggregates?.countInsured ?? "—")}
        loading={loading}
      />
      <MetricCard
        icon={<ClockIcon className="size-3.5" />}
        label={t("drafted")}
        value={String(aggregates?.countByState.drafted ?? "—")}
        loading={loading}
      />
      <MetricCard
        icon={<AlertTriangleIcon className="size-3.5" />}
        label={t("defaultRate")}
        value={defaultRatePct}
        loading={loading}
        hint={t("defaultRateHint")}
      />
    </>
  );
}

/** The BRL side of the book: total guaranteed and the slice in verified default. */
export function GuaranteeExposurePanel({ aggregates }: Props) {
  const t = useTranslations("transparency.guarantees");
  const loading = aggregates === null;

  return (
    <>
      <MetricCard
        icon={<BanknoteIcon className="size-3.5" />}
        label={t("totalGuaranteed")}
        value={aggregates ? formatBRLCents(aggregates.sumInsuredCents) : "—"}
        loading={loading}
        hint={t("totalGuaranteedHint")}
      />
      <MetricCard
        icon={<ShieldAlertIcon className="size-3.5" />}
        label={t("verifiedDefaultExposure")}
        value={aggregates ? formatBRLCents(aggregates.verifiedDefaultExposureCents) : "—"}
        loading={loading}
        hint={t("verifiedDefaultExposureHint", { count: aggregates?.countVerifiedDefault ?? 0 })}
      />
    </>
  );
}
