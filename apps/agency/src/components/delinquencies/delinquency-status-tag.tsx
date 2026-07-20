import type { ReactNode } from "react";
import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";

export type DelinquencyStatus = "open" | "resolved" | "canceled";

const statusTone: Record<DelinquencyStatus, StatusTagTone> = {
  open: "warning",
  resolved: "positive",
  canceled: "neutral",
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
