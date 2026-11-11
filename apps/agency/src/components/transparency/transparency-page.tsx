"use client";

import { useTranslations } from "next-intl";
import { usePreloadedQuery } from "convex/react";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StateTimelineBucket } from "@convex/guarantees/domain";
import type { GuaranteeAggregates, ReserveHealthReading } from "@convex/transparency/domain";
import { ClaimsFunnel } from "./claims-funnel";
import { CoverageSummary } from "./coverage-summary";
import { GuaranteesPanel } from "./guarantees-panel";
import { TransparencySection } from "./transparency-section";
import { PlatformStateChart } from "./platform-state-chart";
import { ReserveSection } from "./reserve-section";
import { useReserveSection } from "./use-reserve-section";

type Props = {
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getGuaranteeAggregates> | null;
  preloadedTimeline: Preloaded<typeof api.guarantees.useCases.getStateTimelineByPeriod> | null;
  preloadedReserve: Preloaded<typeof api.transparency.useCases.getReserveHealth> | null;
  initialAggregates: GuaranteeAggregates | null;
  initialTimeline: StateTimelineBucket[] | null;
  initialReserve: ReserveHealthReading | null;
};

type LiveProps = {
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getGuaranteeAggregates>;
  preloadedTimeline: Preloaded<typeof api.guarantees.useCases.getStateTimelineByPeriod>;
  preloadedReserve: Preloaded<typeof api.transparency.useCases.getReserveHealth>;
};

type LayoutProps = {
  aggregates: GuaranteeAggregates | null | undefined;
  timeline: StateTimelineBucket[] | null | undefined;
  reserve: ReserveHealthReading | null | undefined;
};

function TransparencyPageLayout({ aggregates, timeline, reserve }: LayoutProps) {
  const t = useTranslations("transparency");
  const reserveModel = useReserveSection(reserve);

  const agg = aggregates ?? null;
  const tl = timeline ?? null;

  return (
    <div className="flex flex-col gap-8 px-4 lg:px-6">
      <CoverageSummary aggregates={agg} reserve={reserveModel} />

      <TransparencySection
        id="book-heading"
        title={t("book.title")}
        description={t("book.description")}
      >
        <GuaranteesPanel aggregates={agg} />
        <ClaimsFunnel aggregates={agg} />
        <PlatformStateChart timeline={tl} counts={agg?.countByState} />
      </TransparencySection>

      <ReserveSection model={reserveModel} />

      <p className="text-muted-foreground text-xs">{t("footer")}</p>
    </div>
  );
}

function TransparencyPageLive({
  preloadedAggregates,
  preloadedTimeline,
  preloadedReserve,
}: LiveProps) {
  const aggregates = usePreloadedQuery(preloadedAggregates);
  const timeline = usePreloadedQuery(preloadedTimeline);
  const reserve = usePreloadedQuery(preloadedReserve);
  return <TransparencyPageLayout aggregates={aggregates} timeline={timeline} reserve={reserve} />;
}

export function TransparencyPage({
  preloadedAggregates,
  preloadedTimeline,
  preloadedReserve,
  initialAggregates,
  initialTimeline,
  initialReserve,
}: Props) {
  if (preloadedAggregates && preloadedTimeline && preloadedReserve) {
    return (
      <TransparencyPageLive
        preloadedAggregates={preloadedAggregates}
        preloadedTimeline={preloadedTimeline}
        preloadedReserve={preloadedReserve}
      />
    );
  }

  return (
    <TransparencyPageLayout
      aggregates={initialAggregates}
      timeline={initialTimeline}
      reserve={initialReserve}
    />
  );
}
