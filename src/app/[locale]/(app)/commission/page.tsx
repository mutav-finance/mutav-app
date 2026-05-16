import { getTranslations } from "next-intl/server";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import { PageShell } from "@/components/page/page-shell";
import { CommissionPage } from "@/components/commission/commission-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "commission.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function CommissionRoutePage() {
  const t = await getTranslations("commission");

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <CommissionPage />
      </PageContent>
    </PageShell>
  );
}
