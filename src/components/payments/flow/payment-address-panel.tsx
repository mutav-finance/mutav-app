import { getTranslations } from "next-intl/server";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyableSep7Link } from "@/components/payments/copyable-sep7-link";
import { CopyableValue } from "@/components/payments/copyable-value";
import { AssetAmount } from "@/components/payments/flow/asset-amount";
import { PaymentAddressQrCode } from "@/components/payments/flow/payment-address-qr-code";
import { HorizonPaymentPoller } from "@/components/payments/flow/horizon-payment-poller";

export type AssetOption = {
  code: string;
  label: string;
  amountCanonical: string;
  amountDisplay: string;
  sep7Uri: string;
};

type Props = {
  muxedAddress: string;
  brlDisplay: string;
  options: AssetOption[];
};

export async function PaymentAddressPanel({ muxedAddress, brlDisplay, options }: Props) {
  const t = await getTranslations("paymentFlow.address");
  const truncatedAddress = `${muxedAddress.slice(0, 6)}…${muxedAddress.slice(-6)}`;

  return (
    <section
      id="primary-action"
      className="border-border bg-surface flex flex-col gap-6 border p-6"
      aria-labelledby="payment-address-heading"
    >
      <header className="flex flex-col gap-1">
        <h2 id="payment-address-heading" className="text-text font-sans text-sm font-medium">
          {t("cardLabel")}
        </h2>
      </header>

      <Tabs defaultValue={options[0]!.code} className="flex flex-col gap-6">
        <TabsList
          className="grid w-full"
          style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
          {options.map((option) => (
            <TabsTrigger key={option.code} value={option.code} className="font-mono">
              {option.code}
            </TabsTrigger>
          ))}
        </TabsList>

        {options.map((option) => (
          <TabsContent
            key={option.code}
            value={option.code}
            className="flex flex-col gap-5 outline-none"
          >
            <div className="flex justify-center">
              <PaymentAddressQrCode
                data={option.sep7Uri}
                title={t("qrTitle", { amount: brlDisplay })}
                desc={t("qrDesc")}
              />
            </div>

            <AssetAmount
              amountDisplay={option.amountDisplay}
              assetCode={option.code}
              brlDisplay={brlDisplay}
            />

            <div className="flex flex-col gap-2">
              <p className="text-2xs text-text-2 tracking-[0.06em] uppercase">
                {t("paymentLinkLabel", { asset: option.code })}
              </p>
              <CopyableSep7Link
                uri={option.sep7Uri}
                label={t("copyPaymentLinkLabel", { asset: option.code })}
              />
              <p className="text-text-2 text-xs">{t("paymentLinkHint", { asset: option.code })}</p>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      <Separator />

      <Collapsible>
        <CollapsibleTrigger
          className="text-text hover:text-text-2 focus-visible:text-text flex w-full items-center justify-between gap-2 text-left text-sm transition-colors focus-visible:outline-none"
          aria-label={t("disclosureLabel")}
        >
          <span className="font-sans">{t("disclosureLabel")}</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 transition-opacity duration-150 ease-out data-[state=open]:opacity-100"
            strokeWidth={1.25}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4">
          <ol className="text-text-2 marker:text-text-3 ml-4 flex list-decimal flex-col gap-2 text-sm">
            <li>{t("steps.s1")}</li>
            <li>{t("steps.s2")}</li>
            <li>{t("steps.s3")}</li>
            <li>{t("steps.s4")}</li>
            <li>{t("steps.s5")}</li>
          </ol>
        </CollapsibleContent>
      </Collapsible>

      <div className="text-text-2 flex items-center justify-between gap-3 text-xs">
        <span className="tracking-[0.06em] uppercase">{t("addressFallbackLabel")}</span>
        <CopyableValue
          valueToCopy={muxedAddress}
          display={<span className="text-text">{truncatedAddress}</span>}
          label={t("copyAddressLabel")}
          className="text-text"
        />
      </div>

      <HorizonPaymentPoller />
    </section>
  );
}
