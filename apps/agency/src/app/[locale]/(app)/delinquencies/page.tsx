import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import {
  DelinquencyPage,
  DelinquencyPageActions,
} from "@/components/delinquencies/delinquency-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "delinquencies.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function DelinquenciesRoutePage() {
  const t = await getTranslations("delinquencies");

  return (
    <PageShell>
      <PageHeader
        title={t("heading")}
        subtitle={t("subheading")}
        actions={<DelinquencyPageActions />}
      />
      <PageContent variant="full">
        <DelinquencyPage />
      </PageContent>
    </PageShell>
  );
}
