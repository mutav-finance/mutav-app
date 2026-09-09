"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useWorkspace } from "@/providers/workspace";
import { GuaranteeStateChart } from "@/components/guarantees/guarantee-state-chart";

export function AgencyStateChart() {
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const timeline = useQuery(
    api.guarantees.useCases.getStateTimelineByPeriod,
    agencyId ? { scope: { kind: "agency", agencyId }, granularity: "month" } : "skip",
  );

  const counts = useQuery(
    api.guarantees.useCases.getStatusCounts,
    agencyId ? { agencyId } : "skip",
  );

  return (
    <GuaranteeStateChart
      timeline={timeline ?? null}
      counts={counts ?? null}
      granularity="month"
      i18nNamespace="chart"
      rangeOptions={[
        { value: "6m", periods: 6, labelKey: "last6Months" },
        { value: "12m", periods: 12, labelKey: "last12Months" },
      ]}
      defaultRange="12m"
      showEvents
    />
  );
}
