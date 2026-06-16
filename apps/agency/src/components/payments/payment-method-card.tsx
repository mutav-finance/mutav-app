"use client";

import { useTranslations } from "next-intl";
import { Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@mutav/ui/mono";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { getPayUrl } from "@/lib/env";
import { isChargeable, type Payment } from "@convex/payments/domain";

/**
 * Absolute payment-link URL to the tenant checkout on the pay app. Cross-origin
 * since the split, so this is a plain anchor target — not the next-intl `Link`,
 * and not locale-prefixed: the pay app negotiates the tenant's own locale
 * (Accept-Language / NEXT_LOCALE cookie), which need not match the agent's.
 */
function paymentLinkUrl(publicId: string): string {
  return `${getPayUrl()}/pay/${publicId}`;
}

function MethodRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground text-sm">{value}</dd>
    </div>
  );
}

function ShareTenantLink({ publicId }: { publicId: string }) {
  const t = useTranslations("paymentDetails.methodCard");
  const { copied, copy } = useCopyToClipboard(t("linkCopied"));

  const handleCopy = () => {
    copy(paymentLinkUrl(publicId));
  };

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
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
      <Button asChild size="sm" variant={variant === "primary" ? "default" : "outline"}>
        <a href={paymentLinkUrl(payment.publicId)} target="_blank" rel="noopener">
          {t("openCheckout")}
          <ExternalLink className="size-4" strokeWidth={1.25} />
        </a>
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
            <MethodRow
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
            <MethodRow
              label={t("pixKey")}
              value={<Mono className="text-xs">{method.pixKey}</Mono>}
            />
            <MethodRow
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
              <MethodRow
                label={t("address")}
                value={<Mono className="text-xs break-all">{method.destinationAddress}</Mono>}
              />
              <MethodRow
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
