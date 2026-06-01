import { getTranslations } from "next-intl/server";
import { PaymentListTable } from "@/components/payments/payment-list-table";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "paymentList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function PaymentsPage() {
  const t = await getTranslations("paymentList");

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <PaymentListTable />
      </PageContent>
    </PageShell>
  );
}
