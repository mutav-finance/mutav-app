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
  preloadedAggregates: Preloaded<typeof api.health.useCases.getContractAggregates>;
  preloadedTimeline: Preloaded<typeof api.health.useCases.getTimeline>;
  initialAggregates: ContractAggregates | null;
  initialTimeline: HealthTimeline | null;
};

export function HealthPage({
  preloadedAggregates,
  preloadedTimeline,
  initialAggregates,
  initialTimeline,
}: Props) {
  const t = useTranslations("health");
  const aggregates = usePreloadedQuery(preloadedAggregates);
  const timeline = usePreloadedQuery(preloadedTimeline);

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

  const agg = aggregates ?? initialAggregates;
  const tl = timeline ?? initialTimeline;

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6">
      <div className="grid gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        <ContractsPanel aggregates={agg} />
        <CapacityPanel aggregates={agg} />
        <TreasuryPanel treasury={treasury} error={treasuryError} />
        <TimelinePanel timeline={tl} />
      </div>

      <p className="text-muted-foreground text-xs">{t("footer")}</p>
    </div>
  );
}
