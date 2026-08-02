"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { Mono } from "@mutav/ui/mono";
import { formatBRLCents, formatDateBR, formatPaidAtBR } from "@/lib/contracts/format";
import { PaymentStateTag } from "@/components/payments/payment-state-tag";
import { derivedStatus, INVOICE_STATE_KIND } from "@convex/invoices/domain";
import type { api } from "@convex/_generated/api";

/** Current UTC date as `YYYY-MM-DD` — matches the invoice `dueDate` format. */
function utcTodayDate(): string {
  return new Date().toISOString().split("T")[0]!;
}

type Props = {
  preloaded: Preloaded<typeof api.invoices.useCases.getPublicByAccessToken>;
};

export function PaymentSummaryHeader({ preloaded }: Props) {
  const payment = usePreloadedQuery(preloaded);
  const tAddr = useTranslations("paymentFlow.address");
  const tSummary = useTranslations("paymentFlow.summary");
  const tState = useTranslations("paymentDetails.state");

  if (!payment) return null;

  const status = derivedStatus(payment, utcTodayDate());
  const isSettled = status === "paid" || status === "void";

  const dateLabel =
    payment.state.kind === "paid"
      ? formatPaidAtBR(payment.state.paidAt)
      : formatDateBR(payment.dueDate);
  const dateLabelText =
    payment.state.kind === "paid" ? tSummary("paidAtLabel") : tSummary("dueLabel");

  return (
    <section className="flex flex-col gap-3" aria-labelledby="payment-summary-heading">
      <div className="flex items-center gap-3">
        <PaymentStateTag
          status={status}
          label={tState(status)}
          pulse={payment.state.kind === INVOICE_STATE_KIND.OPEN}
        />
        <span className="text-2xs text-text-2 font-mono tracking-[0.06em] uppercase">
          {payment.agencyName}
        </span>
      </div>
      {!isSettled && (
        <>
          <h1
            id="payment-summary-heading"
            className="font-display text-text text-3xl leading-tight font-bold tracking-tight"
          >
            {tAddr("pageTitle")}
          </h1>
          <p className="text-text-2 text-sm">{tAddr("pageSubtitle")}</p>
        </>
      )}
      <div className="border-border flex flex-col gap-1 border-t pt-3">
        <Mono className="text-text text-3xl font-medium">{formatBRLCents(payment.totalCents)}</Mono>
        <p className="text-text-2 text-sm">
          {dateLabelText} <Mono className="text-text">{dateLabel}</Mono>
        </p>
      </div>
    </section>
  );
}
