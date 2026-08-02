import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link, redirect } from "@mutav/i18n/navigation";
import { CheckoutPixView } from "@/components/payments/checkout/checkout-pix-view";
import { api } from "@convex/_generated/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}) {
  const { locale, publicId } = await params;
  const t = await getTranslations({ locale, namespace: "checkout.pix.meta" });
  return {
    title: t("title", { publicId }),
    description: t("description"),
  };
}

/**
 * Step 2b — pay via PIX. Server renders the chrome and the client island
 * (`CheckoutPixView`) auto-starts the SEP-6 deposit and renders the
 * Pix-shaped instructions inline.
 *
 * State redirects:
 *  - paid           → /paid
 *  - method=stellar → /stellar (user switched back)
 */
export default async function CheckoutPixPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId, locale } = await params;
  const preloaded = await preloadQuery(api.invoices.useCases.getPublicByAccessToken, {
    accessToken: publicId,
  });
  const payment = preloadedQueryResult(preloaded);
  if (!payment) notFound();

  if (payment.state.kind === "paid" || payment.state.kind === "void") {
    redirect({ href: `/pay/${publicId}/paid`, locale });
  }
  if (payment.method?.kind === "stellar") {
    redirect({ href: `/pay/${publicId}/stellar`, locale });
  }

  const t = await getTranslations({ locale, namespace: "checkout.common" });

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/pay/${publicId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="size-3" strokeWidth={1.5} />
        {t("back")}
      </Link>
      <CheckoutPixView
        invoiceId={payment.invoiceId}
        invoiceAccessToken={publicId}
        totalCents={payment.totalCents}
      />
    </div>
  );
}
