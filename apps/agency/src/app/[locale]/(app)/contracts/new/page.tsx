import { getTranslations } from "next-intl/server";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import { PageShell } from "@/components/page/page-shell";
import { ContractWizard } from "@/components/contracts/contract-wizard";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contractNew.meta" });
  return { title: t("title") };
}

export default async function NewContractPage() {
  const t = await getTranslations("contractNew");

  return (
    <PageShell>
      <PageHeader variant="hero" width="narrow" title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="narrow">
        <ContractWizard />
      </PageContent>
    </PageShell>
  );
}
