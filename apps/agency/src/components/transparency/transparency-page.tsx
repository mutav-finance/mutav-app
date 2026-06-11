"use client";

import { useTranslations } from "next-intl";
import { usePreloadedQuery } from "convex/react";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ActivityBucket } from "@convex/contracts/domain";
import type { ContractAggregates, ReserveCoverage } from "@convex/transparency/domain";
import { ContractsPanel } from "./contracts-panel";
import { CapacityPanel } from "./capacity-panel";
import { ReservePanel } from "./reserve-panel";
import { TimelinePanel } from "./timeline-panel";

type Props = {
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getContractAggregates> | null;
  preloadedTimeline: Preloaded<typeof api.contracts.useCases.getActivityByPeriod> | null;
  preloadedCoverage: Preloaded<typeof api.transparency.useCases.getReserveCoverage> | null;
  initialAggregates: ContractAggregates | null;
  initialTimeline: ActivityBucket[] | null;
  initialCoverage: ReserveCoverage | null;
};

type LiveProps = {
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getContractAggregates>;
  preloadedTimeline: Preloaded<typeof api.contracts.useCases.getActivityByPeriod>;
  preloadedCoverage: Preloaded<typeof api.transparency.useCases.getReserveCoverage>;
};

type LayoutProps = {
  aggregates: ContractAggregates | null | undefined;
  timeline: ActivityBucket[] | null | undefined;
  coverage: ReserveCoverage | null | undefined;
};

function TransparencyPageLayout({ aggregates, timeline, coverage }: LayoutProps) {
  const t = useTranslations("transparency");

  const agg = aggregates ?? null;
  const tl = timeline ?? null;

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ContractsPanel aggregates={agg} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CapacityPanel aggregates={agg} />
        <ReservePanel coverage={coverage} />
      </div>

      <TimelinePanel data={tl} />

      <p className="text-muted-foreground text-xs">{t("footer")}</p>
    </div>
  );
}

function TransparencyPageLive({
  preloadedAggregates,
  preloadedTimeline,
  preloadedCoverage,
}: LiveProps) {
  const aggregates = usePreloadedQuery(preloadedAggregates);
  const timeline = usePreloadedQuery(preloadedTimeline);
  const coverage = usePreloadedQuery(preloadedCoverage);
  return <TransparencyPageLayout aggregates={aggregates} timeline={timeline} coverage={coverage} />;
}

export function TransparencyPage({
  preloadedAggregates,
  preloadedTimeline,
  preloadedCoverage,
  initialAggregates,
  initialTimeline,
  initialCoverage,
}: Props) {
  if (preloadedAggregates && preloadedTimeline && preloadedCoverage) {
    return (
      <TransparencyPageLive
        preloadedAggregates={preloadedAggregates}
        preloadedTimeline={preloadedTimeline}
        preloadedCoverage={preloadedCoverage}
      />
    );
  }

  return (
    <TransparencyPageLayout
      aggregates={initialAggregates}
      timeline={initialTimeline}
      coverage={initialCoverage}
    />
  );
}
