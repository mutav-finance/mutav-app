import { StatusTag as UiStatusTag, type StatusTagTone } from "@mutav/ui/status-tag";

type Tone = "accent" | "success" | "error" | "neutral" | "expiring" | "caution";

const TONE: Record<Tone, StatusTagTone> = {
  accent: "info",
  success: "positive",
  error: "critical",
  neutral: "neutral",
  expiring: "warning",
  caution: "warning",
};

export function StatusTag({
  tone,
  label,
  pulse = false,
  className,
}: {
  tone: Tone;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <UiStatusTag tone={TONE[tone]} pulse={pulse} className={className}>
      {label}
    </UiStatusTag>
  );
}
