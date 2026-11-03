import { getTranslations } from "next-intl/server";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { StateTimelineBucket } from "@convex/guarantees/domain";
import type { GuaranteeAggregates, ReserveHealthReading } from "@convex/transparency/domain";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { TransparencyPage } from "@/components/transparency/transparency-page";
import { getAuthToken } from "@/lib/auth-token";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "transparency.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function TransparencyRoutePage() {
  const t = await getTranslations("transparency");

  let preloadedAggregates: Preloaded<
    typeof api.transparency.useCases.getGuaranteeAggregates
  > | null = null;
  let preloadedTimeline: Preloaded<typeof api.guarantees.useCases.getStateTimelineByPeriod> | null =
    null;
  let preloadedReserve: Preloaded<typeof api.transparency.useCases.getReserveHealth> | null = null;
  let aggregates: GuaranteeAggregates | null = null;
  let timeline: StateTimelineBucket[] | null = null;
  let reserve: ReserveHealthReading | null = null;

  try {
    const token = (await getAuthToken()) ?? undefined;
    [preloadedAggregates, preloadedTimeline, preloadedReserve] = await Promise.all([
      preloadQuery(api.transparency.useCases.getGuaranteeAggregates, {}, { token }),
      preloadQuery(
        api.guarantees.useCases.getStateTimelineByPeriod,
        { scope: { kind: "platform" }, granularity: "week" },
        { token },
      ),
      preloadQuery(api.transparency.useCases.getReserveHealth, {}, { token }),
    ]);
    aggregates = preloadedQueryResult(preloadedAggregates);
    timeline = preloadedQueryResult(preloadedTimeline);
    reserve = preloadedQueryResult(preloadedReserve);
  } catch {}

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="wide">
        <TransparencyPage
          preloadedAggregates={preloadedAggregates}
          preloadedTimeline={preloadedTimeline}
          preloadedReserve={preloadedReserve}
          initialAggregates={aggregates}
          initialTimeline={timeline}
          initialReserve={reserve}
        />
      </PageContent>
    </PageShell>
  );
}
