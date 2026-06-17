import { getTranslations } from "next-intl/server";
import { InvoiceListTable } from "@/components/invoices/invoice-list-table";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "invoiceList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function InvoicesPage() {
  const t = await getTranslations("invoiceList");

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <InvoiceListTable />
      </PageContent>
    </PageShell>
  );
}
