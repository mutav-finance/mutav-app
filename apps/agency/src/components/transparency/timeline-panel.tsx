"use client";

import type { ActivityBucket } from "@convex/contracts/domain";
import { ActivityChart } from "@/components/contracts/activity-chart";

type Props = { data: ActivityBucket[] | null };

export function TimelinePanel({ data }: Props) {
  return (
    <ActivityChart
      data={data}
      granularity="week"
      i18nNamespace="transparency.timeline"
      rangeOptions={[
        { value: "m6", periods: 26, labelKey: "m6" },
        { value: "m12", periods: 52, labelKey: "m12" },
      ]}
      defaultRange="m6"
      showTrendIcon
    />
  );
}
