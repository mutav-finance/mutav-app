"use client";

import { useTranslations } from "next-intl";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import { Link, getPathname } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { isChargeable, type Payment } from "@convex/payments/domain";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground text-sm">{value}</dd>
    </div>
  );
}

function ShareTenantLink({ publicId }: { publicId: string }) {
  const t = useTranslations("paymentDetails.methodCard");
  const locale = useLocale();
  const { copied, copy } = useCopyToClipboard(t("linkCopied"));

  const handleCopy = () => {
    const path = getPathname({
      href: `/pay/${publicId}`,
      locale: locale as "pt-BR" | "en",
    });
    copy(`${window.location.origin}${path}`);
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
      {copied ? (
        <Check className="size-4" strokeWidth={1.25} />
      ) : (
        <Copy className="size-4" strokeWidth={1.25} />
      )}
      {t("copyShareLink")}
    </Button>
  );
}

function ChargeableActions({
  payment,
  variant,
}: {
  payment: Payment;
  variant: "primary" | "secondary";
}) {
  const t = useTranslations("paymentDetails.methodCard");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        asChild
        size="sm"
        variant={variant === "primary" ? "default" : "outline"}
        className="gap-2"
      >
        <Link href={`/pay/${payment.publicId}`} target="_blank" rel="noopener">
          {t("openCheckout")}
          <ExternalLink className="size-4" strokeWidth={1.25} />
        </Link>
      </Button>
      <ShareTenantLink publicId={payment.publicId} />
    </div>
  );
}

export function PaymentMethodCard({ payment }: { payment: Payment }) {
  const t = useTranslations("paymentDetails.methodCard");
  const method = payment.method;
  const chargeable = isChargeable(payment.state);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-4">
        {!method && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <p className="text-foreground text-sm font-medium">{t("none")}</p>
              <p className="text-muted-foreground text-xs">{t("noneHint")}</p>
            </div>
            {chargeable && <ChargeableActions payment={payment} variant="primary" />}
          </div>
        )}

        {method?.kind === "boleto" && (
          <dl className="flex flex-col gap-3">
            <FieldRow
              label={t("barcode")}
              value={
                method.barcode ? (
                  <Mono className="text-xs break-all">{method.barcode}</Mono>
                ) : (
                  <span className="text-muted-foreground text-xs italic">{t("barcodeEmpty")}</span>
                )
              }
            />
          </dl>
        )}

        {method?.kind === "pix" && (
          <dl className="flex flex-col gap-3">
            <FieldRow
              label={t("pixKey")}
              value={<Mono className="text-xs">{method.pixKey}</Mono>}
            />
            <FieldRow
              label={t("txId")}
              value={
                method.txId ? (
                  <Mono className="text-xs break-all">{method.txId}</Mono>
                ) : (
                  <span className="text-muted-foreground text-xs italic">{t("txIdEmpty")}</span>
                )
              }
            />
          </dl>
        )}

        {method?.kind === "stellar" && (
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-3">
              <FieldRow
                label={t("address")}
                value={<Mono className="text-xs break-all">{method.destinationAddress}</Mono>}
              />
              <FieldRow
                label={t("txHash")}
                value={
                  method.txHash ? (
                    <Mono className="text-xs break-all">{method.txHash}</Mono>
                  ) : (
                    <span className="text-muted-foreground text-xs italic">{t("txHashEmpty")}</span>
                  )
                }
              />
            </dl>
            {chargeable && <ChargeableActions payment={payment} variant="secondary" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
