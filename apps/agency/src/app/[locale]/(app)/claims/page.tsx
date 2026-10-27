import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { ClaimsQueue } from "@/components/claims/claims-queue";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "delinquencies.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function ClaimsRoutePage() {
  const t = await getTranslations("delinquencies");
  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <ClaimsQueue />
      </PageContent>
    </PageShell>
  );
}
