"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { usePreloadedQuery, useAction } from "convex/react";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ContractAggregates, HealthTimeline, TreasurySnapshot } from "@convex/health/domain";
import { ContractsPanel } from "./contracts-panel";
import { CapacityPanel } from "./capacity-panel";
import { TreasuryPanel } from "./treasury-panel";
import { TimelinePanel } from "./timeline-panel";

type Props = {
  preloadedAggregates: Preloaded<typeof api.health.useCases.getContractAggregates> | null;
  preloadedTimeline: Preloaded<typeof api.health.useCases.getTimeline> | null;
  initialAggregates: ContractAggregates | null;
  initialTimeline: HealthTimeline | null;
};

type LiveProps = {
  preloadedAggregates: Preloaded<typeof api.health.useCases.getContractAggregates>;
  preloadedTimeline: Preloaded<typeof api.health.useCases.getTimeline>;
};

type LayoutProps = {
  aggregates: ContractAggregates | null | undefined;
  timeline: HealthTimeline | null | undefined;
};

function HealthPageLayout({ aggregates, timeline }: LayoutProps) {
  const t = useTranslations("health");
  const fetchTreasury = useAction(api.health.actions.getTreasurySnapshot);
  const [treasury, setTreasury] = React.useState<TreasurySnapshot | null>(null);
  const [treasuryError, setTreasuryError] = React.useState(false);

  const loadTreasury = React.useEffectEvent(() => {
    fetchTreasury({})
      .then(setTreasury)
      .catch(() => setTreasuryError(true));
  });

  React.useEffect(() => {
    loadTreasury();
  }, []);

  const agg = aggregates ?? null;
  const tl = timeline ?? null;

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <ContractsPanel aggregates={agg} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <CapacityPanel aggregates={agg} />
        <TreasuryPanel treasury={treasury} error={treasuryError} />
      </div>

      <TimelinePanel timeline={tl} />

      <p className="text-muted-foreground text-xs">{t("footer")}</p>
    </div>
  );
}

function HealthPageLive({ preloadedAggregates, preloadedTimeline }: LiveProps) {
  const aggregates = usePreloadedQuery(preloadedAggregates);
  const timeline = usePreloadedQuery(preloadedTimeline);
  return <HealthPageLayout aggregates={aggregates} timeline={timeline} />;
}

export function HealthPage({
  preloadedAggregates,
  preloadedTimeline,
  initialAggregates,
  initialTimeline,
}: Props) {
  if (preloadedAggregates && preloadedTimeline) {
    return (
      <HealthPageLive
        preloadedAggregates={preloadedAggregates}
        preloadedTimeline={preloadedTimeline}
      />
    );
  }

  return <HealthPageLayout aggregates={initialAggregates} timeline={initialTimeline} />;
}
