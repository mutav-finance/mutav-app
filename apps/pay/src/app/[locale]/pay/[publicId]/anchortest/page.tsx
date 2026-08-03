import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link, redirect } from "@mutav/i18n/navigation";
import { CheckoutAnchorTestView } from "@/components/payments/checkout/checkout-anchor-test-view";
import { fetchInvoiceDocumentNumber } from "@/lib/invoices/document-number";
import { api } from "@convex/_generated/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}) {
  const { locale, publicId: accessToken } = await params;
  const [t, documentNumber] = await Promise.all([
    getTranslations({ locale, namespace: "checkout.anchortest.meta" }),
    fetchInvoiceDocumentNumber(accessToken),
  ]);
  return {
    title: t("title", { publicId: documentNumber ?? "" }),
    description: t("description"),
  };
}

/**
 * Step 2c — pay via the anchor's hosted SEP-24 UI. The client island
 * (`CheckoutAnchorTestView`) auto-starts the deposit and iframes the
 * anchor's interactive form.
 *
 * State redirects mirror the other method pages: paid/canceled → /paid,
 * already locked to a different method → back to that method's page.
 */
export default async function CheckoutAnchorTestPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId: accessToken, locale } = await params;
  const preloaded = await preloadQuery(api.invoices.useCases.getPublicByAccessToken, {
    accessToken,
  });
  const payment = preloadedQueryResult(preloaded);
  if (!payment) notFound();

  if (payment.state.kind === "paid" || payment.state.kind === "void") {
    redirect({ href: `/pay/${accessToken}/paid`, locale });
  }
  if (payment.method?.kind === "stellar") {
    redirect({ href: `/pay/${accessToken}/stellar`, locale });
  }
  if (payment.method?.kind === "pix") {
    redirect({ href: `/pay/${accessToken}/pix`, locale });
  }

  const t = await getTranslations({ locale, namespace: "checkout.common" });

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/pay/${accessToken}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="size-3" strokeWidth={1.5} />
        {t("back")}
      </Link>
      <CheckoutAnchorTestView invoiceId={payment.invoiceId} totalCents={payment.totalCents} />
    </div>
  );
}
