import type { ReactNode } from "react";
import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";

export type DelinquencyStatus = "pendencia_aberta" | "entregue" | "cancelado";

const statusTone: Record<DelinquencyStatus, StatusTagTone> = {
  pendencia_aberta: "warning",
  entregue: "positive",
  cancelado: "neutral",
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
