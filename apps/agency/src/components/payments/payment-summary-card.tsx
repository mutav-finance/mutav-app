import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono } from "@/components/ui/mono";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import { formatPeriodMonth } from "@/lib/payments/format";
import type { Payment } from "@convex/payments/domain";
import { PaymentStateTag } from "./payment-state-tag";

export function PaymentSummaryCard({ payment }: { payment: Payment }) {
  const t = useTranslations("paymentDetails.summary");
  const tState = useTranslations("paymentDetails.state");
  const tMethod = useTranslations("paymentDetails.method");

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-muted-foreground font-mono text-xs font-medium tracking-[0.06em] uppercase">
          {t("heading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-2xs text-muted-foreground font-mono font-medium tracking-[0.06em] uppercase">
            {t("idLabel")}
          </span>
          <Mono className="text-foreground text-xl font-medium">{payment.publicId}</Mono>
        </div>
        <dl className="text-base-sm grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("state")}</dt>
            <dd>
              <PaymentStateTag
                stateKind={payment.state.kind}
                label={tState(payment.state.kind)}
                pulse={payment.state.kind === "pending" || payment.state.kind === "overdue"}
              />
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("period")}</dt>
            <dd>
              <Mono className="font-medium">{formatPeriodMonth(payment.periodMonth)}</Mono>
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("dueDate")}</dt>
            <dd>
              <Mono className="font-medium">{formatDateBR(payment.dueDate)}</Mono>
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("issuedAt")}</dt>
            <dd>
              <Mono className="font-medium">{formatDateBR(payment.issuedAt)}</Mono>
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("total")}</dt>
            <dd>
              <Mono className="font-medium">{formatBRLCents(payment.totalCents)}</Mono>
            </dd>
          </div>
          <div className="flex items-center gap-3">
            <dt className="text-muted-foreground">{t("method")}</dt>
            <dd>
              <span className="text-foreground text-sm">
                {payment.method
                  ? tMethod(payment.method.kind as "boleto" | "pix" | "stellar")
                  : tMethod("none")}
              </span>
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
