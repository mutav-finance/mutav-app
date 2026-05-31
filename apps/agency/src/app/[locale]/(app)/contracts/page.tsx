import { getTranslations } from "next-intl/server";
import { ContractListTable } from "@/components/contracts/contract-list-table";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import { PageShell } from "@/components/page/page-shell";
import { CreateContractButton } from "@/components/contracts/create-contract-button";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contractList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function ContractsPage() {
  const t = await getTranslations("contractList");

  return (
    <PageShell>
      <PageHeader
        title={t("heading")}
        subtitle={t("subheading")}
        actions={<CreateContractButton label={t("createButton")} />}
      />
      <PageContent variant="full">
        <ContractListTable emptyStateCta={t("emptyStateCta")} />
      </PageContent>
    </PageShell>
  );
}
