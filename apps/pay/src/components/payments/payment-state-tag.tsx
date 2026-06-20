import { cn } from "@mutav/ui/cn";
import type { InvoiceDisplayStatus } from "@convex/invoices/domain";

type Tone = "accent" | "success" | "error" | "neutral" | "warning";

const toneClass: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  error: "bg-destructive",
  warning: "bg-yellow-500",
  neutral: "bg-muted-foreground",
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
        className={cn("size-[6px] shrink-0", toneClass[tone], pulse && "tga-live-pulse")}
      />
      <span className="text-2xs text-foreground font-mono font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
    </span>
  );
}
