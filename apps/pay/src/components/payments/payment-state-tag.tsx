import { cn } from "@mutav/ui/cn";
import type { InvoiceDisplayStatus } from "@convex/invoices/domain";

type Tone = "accent" | "success" | "error" | "neutral" | "warning";

/**
 * Every tone paints from a brand token, so this surface inherits palette
 * corrections instead of drifting from them. `warning` was a raw `yellow-500`
 * until #320 re-stepped `--warning` for colorblind separation and left this
 * one tag behind on the old hue.
 */
const toneClass: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  error: "bg-error",
  warning: "bg-warning",
  neutral: "bg-text-3",
};

const paymentStateTone: Record<InvoiceDisplayStatus, Tone> = {
  open: "accent",
  overdue: "warning",
  paid: "success",
  void: "neutral",
};

export function PaymentStateTag({
  status,
  label,
  pulse = false,
  className,
}: {
  status: InvoiceDisplayStatus;
  label: string;
  pulse?: boolean;
  className?: string;
}) {
  const tone = paymentStateTone[status];
  return (
    <span className={cn("inline-flex items-center gap-2 align-middle", className)}>
      <span
        aria-hidden
        className={cn("size-[6px] shrink-0", toneClass[tone], pulse && "mutav-live-pulse")}
      />
      <span className="text-2xs text-foreground font-mono font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
    </span>
  );
}
