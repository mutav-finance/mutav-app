import { getTranslations } from "next-intl/server";
import { GuaranteeListTable } from "@/components/guarantees/guarantee-list-table";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { CreateGuaranteeButton } from "@/components/guarantees/create-guarantee-button";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guaranteeList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function GuaranteesPage() {
  const t = await getTranslations("guaranteeList");

  return (
    <PageShell>
      <PageHeader
        title={t("heading")}
        subtitle={t("subheading")}
        actions={<CreateGuaranteeButton label={t("createButton")} />}
      />
      <PageContent variant="full">
        <GuaranteeListTable emptyStateCta={t("emptyStateCta")} />
      </PageContent>
    </PageShell>
  );
}
