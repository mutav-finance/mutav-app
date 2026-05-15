import { getTranslations } from "next-intl/server";
import type { Id } from "@convex/_generated/dataModel";
import { AgencyEtherfuseOnboarding } from "@/components/admin/agency-etherfuse-onboarding";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import { PageShell } from "@/components/page/page-shell";

type PageParams = { locale: string; id: string };

export async function generateMetadata({ params }: { params: Promise<PageParams> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.etherfuse" });
  return { title: t("title") };
}

export default async function AgencyEtherfusePage({ params }: { params: Promise<PageParams> }) {
  const { id, locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin.etherfuse" });
  const agencyId = id as Id<"agencies">; // route param validated by route shape

  return (
    <PageShell>
      <PageHeader variant="hero" width="narrow" title={t("title")} />
      <PageContent variant="narrow">
        <AgencyEtherfuseOnboarding agencyId={agencyId} />
      </PageContent>
    </PageShell>
  );
}
