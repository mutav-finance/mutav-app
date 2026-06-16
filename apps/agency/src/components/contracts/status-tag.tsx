import type { ReactNode } from "react";
import { StatusTag as UiStatusTag, type StatusTagTone } from "@mutav/ui/status-tag";

type Tone = "accent" | "success" | "error" | "neutral" | "expiring" | "caution";

const TONE: Record<Tone, StatusTagTone> = {
  accent: "neutral",
  success: "positive",
  error: "critical",
  neutral: "neutral",
  expiring: "warning",
  caution: "warning-strong",
};

export function StatusTag({
  tone,
  children,
  pulse = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <UiStatusTag tone={TONE[tone]} pulse={pulse} className={className}>
      {children}
    </UiStatusTag>
  );
}
