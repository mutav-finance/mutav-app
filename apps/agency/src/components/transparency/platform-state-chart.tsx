"use client";

import type { StateTimelineBucket } from "@convex/guarantees/domain";
import { GuaranteeStateChart } from "@/components/guarantees/guarantee-state-chart";
import type { GuaranteeStateCounts } from "@/lib/guarantees/state-chart";

type Props = {
  timeline: StateTimelineBucket[] | null;
  counts: GuaranteeStateCounts | null | undefined;
};

/**
 * Same card as the dashboard's, trend only. The event bars are opted out here
 * because this page buckets by WEEK: five grouped bars across 26 or 52 weekly
 * slots render as slivers, and a mark that cannot be read is worse than no
 * mark. Nothing else about the two callers has diverged, so the component
 * stays shared.
 */
export function PlatformStateChart({ timeline, counts }: Props) {
  return (
    <GuaranteeStateChart
      timeline={timeline}
      counts={counts}
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
