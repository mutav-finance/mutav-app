import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { api } from "@convex/_generated/api";
import { PublicHeader } from "@/components/public/public-header";
import { PublicFooter } from "@/components/public/public-footer";
import { PageContent } from "@/components/page/page-content";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}) {
  const { locale, publicId } = await params;
  const t = await getTranslations({ locale, namespace: "paymentFlow.meta" });
  return {
    title: t("title", { publicId }),
    description: t("description"),
  };
}

export default async function PaymentAddressPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId, locale } = await params;
  const assets = getActiveAssets(getStellarNetwork());
  const [preloadedPayment, rates] = await Promise.all([
    preloadQuery(api.payments.useCases.getPublicByPublicId, { publicId }),
    getBrlRates(assets.map((a) => a.symbol)),
  ]);
  const payment = preloadedQueryResult(preloadedPayment);
  if (!payment || !payment.muxedAddress) {
    notFound();
  }

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
      amountCanonical: amount.canonical,
      amountDisplay: amount.display,
      sep7Uri: buildSep7PayUri({
        destination: payment.muxedAddress!,
        amount: amount.canonical,
        assetCode: asset.symbol,
        assetIssuer: asset.issuer ?? undefined,
      }),
    };
  });

  return (
    <>
      <PublicHeader publicId={payment.publicId} />
      <div className="flex-1">
        <PageContent variant="narrow" className="py-6 md:py-10">
          <PaymentSummaryHeader preloaded={preloadedPayment} />
          <PaymentAddressView preloaded={preloadedPayment}>
            <PaymentAddressPanel
              muxedAddress={payment.muxedAddress}
              brlDisplay={formatBRLCents(payment.totalCents)}
              options={options}
            />
          </PaymentAddressView>
        </PageContent>
      </div>
      <PublicFooter />
    </>
  );
}
