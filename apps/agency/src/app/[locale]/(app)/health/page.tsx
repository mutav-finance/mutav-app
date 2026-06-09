import { getTranslations } from "next-intl/server";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { HealthPage } from "@/components/health/health-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "health.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function HealthRoutePage() {
  const t = await getTranslations("health");

  const [preloadedAggregates, preloadedTimeline] = await Promise.all([
    preloadQuery(api.health.useCases.getContractAggregates, {}),
    preloadQuery(api.health.useCases.getTimeline, {}),
  ]);

  const aggregates = preloadedQueryResult(preloadedAggregates);
  const timeline = preloadedQueryResult(preloadedTimeline);

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
