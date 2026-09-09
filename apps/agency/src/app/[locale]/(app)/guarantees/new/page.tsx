import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { GuaranteeWizard } from "@/components/guarantees/guarantee-wizard";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contractNew.meta" });
  return { title: t("title") };
}

export default async function NewGuaranteePage() {
  const t = await getTranslations("contractNew");

  return (
    <PageShell>
      <PageHeader variant="hero" width="narrow" title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="narrow">
        <GuaranteeWizard />
      </PageContent>
    </PageShell>
  );
}
