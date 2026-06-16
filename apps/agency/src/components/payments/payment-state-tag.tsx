import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";
import type { PaymentStateKind } from "@convex/payments/domain";

export const paymentStateTone: Record<PaymentStateKind, StatusTagTone> = {
  pending: "neutral",
  overdue: "warning-strong",
  paid: "positive",
  canceled: "neutral",
};

export function PaymentStateTag({
  stateKind,
  label,
  pulse = false,
  className,
}: {
  stateKind: PaymentStateKind;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <StatusTag tone={paymentStateTone[stateKind]} pulse={pulse} className={className}>
      {label}
    </StatusTag>
  );
}
