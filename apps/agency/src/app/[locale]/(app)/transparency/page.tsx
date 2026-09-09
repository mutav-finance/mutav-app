import { getTranslations } from "next-intl/server";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ActivityBucket } from "@convex/guarantees/domain";
import type { GuaranteeAggregates, ReserveCoverage } from "@convex/transparency/domain";
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
  let preloadedTimeline: Preloaded<typeof api.guarantees.useCases.getActivityByPeriod> | null = null;
  let preloadedCoverage: Preloaded<typeof api.transparency.useCases.getReserveCoverage> | null =
    null;
  let aggregates: GuaranteeAggregates | null = null;
  let timeline: ActivityBucket[] | null = null;
  let coverage: ReserveCoverage | null = null;

  try {
    const token = (await getAuthToken()) ?? undefined;
    [preloadedAggregates, preloadedTimeline, preloadedCoverage] = await Promise.all([
      preloadQuery(api.transparency.useCases.getGuaranteeAggregates, {}, { token }),
      preloadQuery(
        api.guarantees.useCases.getActivityByPeriod,
        { scope: { kind: "platform" }, granularity: "week" },
        { token },
      ),
      preloadQuery(api.transparency.useCases.getReserveCoverage, {}, { token }),
    ]);
    aggregates = preloadedQueryResult(preloadedAggregates);
    timeline = preloadedQueryResult(preloadedTimeline);
    coverage = preloadedQueryResult(preloadedCoverage);
  } catch {}

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="wide">
        <TransparencyPage
          preloadedAggregates={preloadedAggregates}
          preloadedTimeline={preloadedTimeline}
          preloadedCoverage={preloadedCoverage}
          initialAggregates={aggregates}
          initialTimeline={timeline}
          initialCoverage={coverage}
        />
      </PageContent>
    </PageShell>
  );
}
