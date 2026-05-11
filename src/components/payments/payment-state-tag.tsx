import { cn } from "@/lib/utils";
import type { PaymentStateKind } from "@convex/payments/domain";

type Tone = "accent" | "success" | "error" | "neutral" | "warning";

const toneClass: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  error: "bg-destructive",
  warning: "bg-yellow-500",
  neutral: "bg-muted-foreground",
};

export const paymentStateTone: Record<PaymentStateKind, Tone> = {
  pending: "accent",
  overdue: "warning",
  paid: "success",
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
  const tone = paymentStateTone[stateKind];
  return (
    <span className={cn("inline-flex items-center gap-2 align-middle", className)}>
      <span
        aria-hidden
        className={cn("size-[6px] shrink-0", toneClass[tone], pulse && "tga-live-square")}
      />
      <span className="text-2xs text-foreground font-mono font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
    </span>
  );
}
