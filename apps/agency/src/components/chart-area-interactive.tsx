"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useWorkspace } from "@/providers/workspace";
import { ActivityChart } from "@/components/contracts/activity-chart";

export function ChartAreaInteractive() {
  const { selectedAgency } = useWorkspace();

  const data = useQuery(
    api.contracts.useCases.getActivityByPeriod,
    selectedAgency
      ? { scope: { kind: "agency", agencyId: selectedAgency._id }, granularity: "month" }
      : "skip",
  );

  return (
    <ActivityChart
      data={data ?? null}
      granularity="month"
      i18nNamespace="chart"
      rangeOptions={[
        { value: "6m", periods: 6, labelKey: "last6Months" },
        { value: "12m", periods: 12, labelKey: "last12Months" },
      ]}
      defaultRange="12m"
    />
  );
}
