import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import type { Payment } from "@convex/payments/domain";

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground text-sm">{value}</dd>
    </div>
  );
}

export function PaymentMethodCard({ payment }: { payment: Payment }) {
  const t = useTranslations("paymentDetails.methodCard");
  const method = payment.method;

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-4">
        {!method && (
          <div className="flex flex-col gap-1">
            <p className="text-foreground text-sm font-medium">{t("none")}</p>
            <p className="text-muted-foreground text-xs">{t("noneHint")}</p>
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
        )}
      </CardContent>
    </Card>
  );
}
