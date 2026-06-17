import type { ReactNode } from "react";
import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";
import type { InvoiceDisplayStatus } from "@convex/invoices/domain";

export const invoiceStatusTone: Record<InvoiceDisplayStatus, StatusTagTone> = {
  open: "neutral",
  overdue: "warning-strong",
  paid: "positive",
  void: "neutral",
};

export function InvoiceStatusTag({
  status,
  children,
  pulse = false,
  className,
}: {
  status: InvoiceDisplayStatus;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <StatusTag tone={invoiceStatusTone[status]} pulse={pulse} className={className}>
      {children}
    </StatusTag>
  );
}
