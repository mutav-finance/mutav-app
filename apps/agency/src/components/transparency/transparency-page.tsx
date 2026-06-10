"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { usePreloadedQuery } from "convex/react";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ActivityBucket } from "@convex/contracts/domain";
import type { ContractAggregates } from "@convex/transparency/domain";
import { ContractsPanel } from "./contracts-panel";
import { CapacityPanel } from "./capacity-panel";
import { TreasuryPanel } from "./treasury-panel";
import { TimelinePanel } from "./timeline-panel";

type Props = {
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getContractAggregates> | null;
  preloadedTimeline: Preloaded<typeof api.contracts.useCases.getActivityByPeriod> | null;
  initialAggregates: ContractAggregates | null;
  initialTimeline: ActivityBucket[] | null;
};

type LiveProps = {
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getContractAggregates>;
  preloadedTimeline: Preloaded<typeof api.contracts.useCases.getActivityByPeriod>;
};

type LayoutProps = {
  aggregates: ContractAggregates | null | undefined;
  timeline: ActivityBucket[] | null | undefined;
};

function TransparencyPageLayout({ aggregates, timeline }: LayoutProps) {
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
        <TreasuryPanel treasury={null} error={false} />
      </div>

      <TimelinePanel data={tl} />

      <p className="text-muted-foreground text-xs">{t("footer")}</p>
    </div>
  );
}

function TransparencyPageLive({ preloadedAggregates, preloadedTimeline }: LiveProps) {
  const aggregates = usePreloadedQuery(preloadedAggregates);
  const timeline = usePreloadedQuery(preloadedTimeline);
  return <TransparencyPageLayout aggregates={aggregates} timeline={timeline} />;
}

export function TransparencyPage({
  preloadedAggregates,
  preloadedTimeline,
  initialAggregates,
  initialTimeline,
}: Props) {
  if (preloadedAggregates && preloadedTimeline) {
    return (
      <TransparencyPageLive
        preloadedAggregates={preloadedAggregates}
        preloadedTimeline={preloadedTimeline}
      />
    );
  }

  return <TransparencyPageLayout aggregates={initialAggregates} timeline={initialTimeline} />;
}
