"use client";

import { useTranslations } from "next-intl";
import { FileTextIcon, ClockIcon, AlertTriangleIcon } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { ContractAggregates } from "@convex/transparency/domain";

type Props = { aggregates: ContractAggregates | null };

function MetricCard({
  icon,
  label,
  value,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  loading: boolean;
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
    </Card>
  );
}

export function ContractsPanel({ aggregates }: Props) {
  const t = useTranslations("transparency.contracts");
  const loading = aggregates === null;

  const defaultRatePct = aggregates ? `${(aggregates.defaultRate * 100).toFixed(1)}%` : "—";

  return (
    <>
      <MetricCard
        icon={<FileTextIcon className="size-3.5" />}
        label={t("ativo")}
        value={String(aggregates?.countAtivos ?? "—")}
        loading={loading}
      />
      <MetricCard
        icon={<ClockIcon className="size-3.5" />}
        label={t("pendente")}
        value={String(aggregates?.countPendentes ?? "—")}
        loading={loading}
      />
      <MetricCard
        icon={<AlertTriangleIcon className="size-3.5" />}
        label={t("defaultRate")}
        value={defaultRatePct}
        loading={loading}
      />
    </>
  );
}
