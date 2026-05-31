"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { Mono } from "@/components/ui/mono";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import { PaymentStateTag } from "@/components/payments/payment-state-tag";
import { PAYMENT_STATE_KIND } from "@convex/payments/domain";
import type { api } from "@convex/_generated/api";

type Props = {
  preloaded: Preloaded<typeof api.payments.useCases.getPublicByPublicId>;
};

export function PaymentSummaryHeader({ preloaded }: Props) {
  const payment = usePreloadedQuery(preloaded);
  const tAddr = useTranslations("paymentFlow.address");
  const tSummary = useTranslations("paymentFlow.summary");
  const tState = useTranslations("paymentDetails.state");

  if (!payment) return null;

  const stateKind = payment.state.kind;
  const isSettled = stateKind === "paid" || stateKind === "canceled";

  const dateLabel =
    payment.state.kind === "paid"
      ? formatPaidAt(payment.state.paidAt)
      : formatDateBR(payment.dueDate);
  const dateLabelText =
    payment.state.kind === "paid" ? tSummary("paidAtLabel") : tSummary("dueLabel");

  return (
    <section className="flex flex-col gap-3" aria-labelledby="payment-summary-heading">
      <div className="flex items-center gap-3">
        <PaymentStateTag
          stateKind={stateKind}
          label={tState(stateKind)}
          pulse={stateKind === PAYMENT_STATE_KIND.PENDING}
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

function formatPaidAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}
