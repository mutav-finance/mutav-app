import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { Link, redirect } from "@mutav/i18n/navigation";
import { PaymentSummaryHeader } from "@/components/payments/flow/payment-summary-header";
import { PaymentAddressView } from "@/components/payments/flow/payment-address-view";
import {
  PaymentAddressPanel,
  type AssetOption,
} from "@/components/payments/flow/payment-address-panel";
import { brlCentsToAsset } from "@/lib/stellar/asset-format";
import { formatBRLCents } from "@/lib/contracts/format";
import { buildSep7PayUri } from "@/lib/stellar/sep7";
import { getActiveAssets, type ResolvedAsset } from "@/lib/stellar/assets";
import { getStellarNetwork } from "@/lib/stellar/network";
import { getBrlRates } from "@/lib/stellar/price-feed";
import { fetchInvoiceDocumentNumber } from "@/lib/invoices/document-number";
import { api } from "@convex/_generated/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}) {
  const { locale, publicId: accessToken } = await params;
  const [t, documentNumber] = await Promise.all([
    getTranslations({ locale, namespace: "checkout.stellar.meta" }),
    fetchInvoiceDocumentNumber(accessToken),
  ]);
  return {
    title: t("title", { publicId: documentNumber ?? "" }),
    description: t("description"),
  };
}

/**
 * Step 2a — pay from a Stellar wallet (XLM or USDC). Renders the
 * existing SEP-7 panel (QR + address + asset tabs + Horizon poller)
 * inside the checkout chrome. Redirects to /paid on settle and to /pix
 * if the user picked PIX instead.
 */
export default async function CheckoutStellarPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId: accessToken, locale } = await params;
  const assets = getActiveAssets(getStellarNetwork());
  const [preloadedPayment, rates] = await Promise.all([
    preloadQuery(api.invoices.useCases.getPublicByAccessToken, { accessToken }),
    getBrlRates(assets.map((a) => a.symbol)),
  ]);
  const payment = preloadedQueryResult(preloadedPayment);
  if (!payment || !payment.muxedAddress) notFound();
  // Hoist past notFound() so the narrowing survives the .map() closure below.
  const muxedAddress = payment.muxedAddress;

  if (payment.state.kind === "paid" || payment.state.kind === "void") {
    redirect({ href: `/pay/${accessToken}/paid`, locale });
  }
  if (payment.method?.kind === "pix") {
    redirect({ href: `/pay/${accessToken}/pix`, locale });
  }

  const t = await getTranslations({ locale, namespace: "checkout.common" });
  const labelLocale = locale === "pt-BR" ? "ptBR" : "en";
  const options: AssetOption[] = assets.map((asset) => {
    const liveAsset: ResolvedAsset = {
      ...asset,
      brlPerUnit: rates[asset.symbol] ?? asset.brlPerUnit,
    };
    const amount = brlCentsToAsset(payment.totalCents, liveAsset, locale);
    return {
      code: asset.symbol,
      label: asset.label[labelLocale],
      amountDisplay: amount.display,
      sep7Uri: buildSep7PayUri({
        destination: muxedAddress,
        amount: amount.canonical,
        assetCode: asset.symbol,
        assetIssuer: asset.issuer ?? undefined,
      }),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/pay/${accessToken}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
      >
        <ArrowLeft className="size-3" strokeWidth={1.5} />
        {t("back")}
      </Link>
      <PaymentSummaryHeader preloaded={preloadedPayment} />
      <PaymentAddressView preloaded={preloadedPayment}>
        <PaymentAddressPanel
          muxedAddress={muxedAddress}
          brlDisplay={formatBRLCents(payment.totalCents)}
          options={options}
        />
      </PaymentAddressView>
    </div>
  );
}
