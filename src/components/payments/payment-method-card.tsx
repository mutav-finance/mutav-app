"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { ExternalLink, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import { Link, getPathname } from "@/i18n/navigation";
import { useLocale } from "next-intl";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useWorkspace } from "@/providers/workspace";
import { api } from "@convex/_generated/api";
import { isChargeable, type Payment } from "@convex/payments/domain";
import { MethodSelector } from "./method-selector";
import { PixAnchorQr } from "./pix-anchor-qr";

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
      href: `/pagar/${publicId}/endereco`,
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
  publicId,
  variant,
}: {
  publicId: string;
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
        <Link href={`/pagar/${publicId}/endereco`} target="_blank" rel="noopener">
          {variant === "primary" ? t("generateStellar") : t("openPayPage")}
          <ExternalLink className="size-4" strokeWidth={1.25} />
        </Link>
      </Button>
      <ShareTenantLink publicId={publicId} />
    </div>
  );
}

function SettlingNotice() {
  const t = useTranslations("paymentDetails.methodCard");
  return <p className="text-muted-foreground text-center text-xs">{t("pixAnchorSettling")}</p>;
}

function PixAnchorBranch({
  payment,
  method,
}: {
  payment: Payment;
  method: Extract<NonNullable<Payment["method"]>, { kind: "pix_anchor" }>;
}) {
  const createPaymentOrder = useAction(api.anchors.actions.createPaymentOrder);
  const onRampRow = useQuery(api.anchors.useCases.getOnRampTransaction, {
    id: method.anchorOnRampTransactionId,
  });

  const handleRegenerate = React.useCallback(async () => {
    const result = await createPaymentOrder({ paymentId: payment._id });
    if (!result.success) {
      toast.error(result.message);
    }
  }, [createPaymentOrder, payment._id]);

  const isSettling = onRampRow?.status === "processing";

  return (
    <div className="flex flex-col gap-4">
      <PixAnchorQr
        pixCode={method.pixCode}
        expiresAt={method.expiresAt}
        onRegenerate={handleRegenerate}
      />
      {isSettling && <SettlingNotice />}
    </div>
  );
}

function NoMethodBranch({ payment }: { payment: Payment }) {
  const t = useTranslations("paymentDetails.methodCard");
  const { selectedAgency } = useWorkspace();
  const createPaymentOrder = useAction(api.anchors.actions.createPaymentOrder);
  const agencyDoc = useQuery(
    api.agencies.useCases.getById,
    selectedAgency ? { agencyId: selectedAgency._id } : "skip",
  );

  const etherfuseStatus = agencyDoc?.etherfuseOnboardingStatus ?? null;

  const handleSelectPixAnchor = React.useCallback(async () => {
    const result = await createPaymentOrder({ paymentId: payment._id });
    if (!result.success) {
      toast.error(result.message);
    }
  }, [createPaymentOrder, payment._id]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-sm font-medium">{t("none")}</p>
        <p className="text-muted-foreground text-xs">{t("noneHint")}</p>
      </div>
      <MethodSelector
        agencyEtherfuseStatus={etherfuseStatus}
        currentMethodKind={null}
        onSelectPixAnchor={handleSelectPixAnchor}
      />
      <ChargeableActions publicId={payment.publicId} variant="primary" />
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
        {!method &&
          (chargeable ? (
            <NoMethodBranch payment={payment} />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <p className="text-foreground text-sm font-medium">{t("none")}</p>
                <p className="text-muted-foreground text-xs">{t("noneHint")}</p>
              </div>
            </div>
          ))}

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

        {method?.kind === "pix_anchor" && <PixAnchorBranch payment={payment} method={method} />}

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
            {chargeable && <ChargeableActions publicId={payment.publicId} variant="secondary" />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
