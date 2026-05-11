import { getTranslations } from "next-intl/server";
import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { PaymentListTable } from "@/components/payments/payment-list-table";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import { PageShell } from "@/components/page/page-shell";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "paymentList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function PaymentsPage() {
  const t = await getTranslations("paymentList");
  const preloaded = await preloadQuery(api.payments.useCases.list, {
    paginationOpts: { numItems: 100, cursor: null },
  });

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <PaymentListTable preloaded={preloaded} />
      </PageContent>
    </PageShell>
  );
}
