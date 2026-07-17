import type { ReactNode } from "react";
import type { DelinquencyStatus } from "@convex/delinquencies/domain";
import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";

const statusTone: Record<DelinquencyStatus, StatusTagTone> = {
  open: "warning",
  under_review: "warning-strong",
  provisioned: "critical",
  paid: "positive",
  closed: "neutral",
};

export function DelinquencyStatusTag({
  status,
  children,
  className,
}: {
  status: DelinquencyStatus;
  children: ReactNode;
  className?: string;
}) {
  return (
    <StatusTag tone={statusTone[status]} className={className}>
      {children}
    </StatusTag>
  );
}
