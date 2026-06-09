import { getTranslations } from "next-intl/server";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import type { Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ContractAggregates, HealthTimeline } from "@convex/health/domain";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { HealthPage } from "@/components/health/health-page";
import { getAuthToken } from "@/lib/auth-token";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "health.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function HealthRoutePage() {
  const t = await getTranslations("health");

  let preloadedAggregates: Preloaded<typeof api.health.useCases.getContractAggregates> | null =
    null;
  let preloadedTimeline: Preloaded<typeof api.health.useCases.getTimeline> | null = null;
  let aggregates: ContractAggregates | null = null;
  let timeline: HealthTimeline | null = null;

  try {
    const token = (await getAuthToken()) ?? undefined;
    [preloadedAggregates, preloadedTimeline] = await Promise.all([
      preloadQuery(api.health.useCases.getContractAggregates, {}, { token }),
      preloadQuery(api.health.useCases.getTimeline, {}, { token }),
    ]);
    aggregates = preloadedQueryResult(preloadedAggregates);
    timeline = preloadedQueryResult(preloadedTimeline);
  } catch {}

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="wide">
        <HealthPage
          preloadedAggregates={preloadedAggregates}
          preloadedTimeline={preloadedTimeline}
          initialAggregates={aggregates}
          initialTimeline={timeline}
        />
      </PageContent>
    </PageShell>
  );
}
