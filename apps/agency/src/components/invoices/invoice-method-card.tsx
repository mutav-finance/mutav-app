"use client";

import { useTranslations } from "next-intl";
import { Copy, Check, ExternalLink } from "lucide-react";
import { useQuery } from "convex/react";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Mono } from "@mutav/ui/mono";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { formatBRLCents } from "@/lib/contracts/format";
import { getPayUrl } from "@/lib/env";
import { api } from "@convex/_generated/api";
import { isChargeable, type Invoice } from "@convex/invoices/domain";
import type { Payment } from "@convex/payments/domain";

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
  const t = useTranslations("invoiceDetails.methodCard");
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
  payment: Invoice;
  variant: "primary" | "secondary";
}) {
  const t = useTranslations("invoiceDetails.methodCard");
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

function SettlementRow({ settlement }: { settlement: Payment }) {
  const t = useTranslations("invoiceDetails.methodCard.settlements");
  const tStatus = useTranslations("paymentStatus");
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-foreground text-sm">{t(`method.${settlement.method.kind}`)}</span>
      <div className="flex items-baseline gap-3">
        <Mono className="text-muted-foreground text-xs">
          {formatBRLCents(settlement.amountCents)}
        </Mono>
        <span className="text-muted-foreground text-xs">{tStatus(settlement.status)}</span>
      </div>
    </div>
  );
}

function SettlementList({ invoiceId }: { invoiceId: Invoice["_id"] }) {
  const t = useTranslations("invoiceDetails.methodCard.settlements");
  const settlements = useQuery(api.payments.useCases.listByInvoice, { invoiceId });

  if (!settlements || settlements.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 border-t pt-4">
      <Eyebrow size="xs" className="text-muted-foreground font-medium">
        {t("heading")}
      </Eyebrow>
      <div className="flex flex-col gap-2">
        {settlements.map((settlement) => (
          <SettlementRow key={settlement._id} settlement={settlement} />
        ))}
      </div>
    </div>
  );
}

export function InvoiceMethodCard({ payment }: { payment: Invoice }) {
  const t = useTranslations("invoiceDetails.methodCard");
  const method = payment.method;
  const chargeable = isChargeable(payment.state);

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
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

        <SettlementList invoiceId={payment._id} />
      </CardContent>
    </Card>
  );
}
