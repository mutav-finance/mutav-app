"use client";

import type { StateTimelineBucket } from "@convex/guarantees/domain";
import { GuaranteeStateChart } from "@/components/guarantees/guarantee-state-chart";
import type { GuaranteeStateCounts } from "@/lib/guarantees/state-chart";

type Props = {
  timeline: StateTimelineBucket[] | null;
  counts: GuaranteeStateCounts | null | undefined;
};

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
