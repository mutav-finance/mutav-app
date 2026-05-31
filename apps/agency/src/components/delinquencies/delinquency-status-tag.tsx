import { cn } from "@/lib/utils";

export type DelinquencyStatus = "pendencia_aberta" | "entregue" | "cancelado";

type Tone = "warning" | "success" | "neutral";

const toneClass: Record<Tone, string> = {
  warning: "bg-yellow-500",
  success: "bg-success",
  neutral: "bg-muted-foreground",
};

const statusTone: Record<DelinquencyStatus, Tone> = {
  pendencia_aberta: "warning",
  entregue: "success",
  cancelado: "neutral",
};

export function DelinquencyStatusTag({
  status,
  label,
  className,
}: {
  status: DelinquencyStatus;
  label: string;
  className?: string;
}) {
  const tone = statusTone[status];
  return (
    <span className={cn("inline-flex items-center gap-2 align-middle", className)}>
      <span aria-hidden className={cn("size-[6px] shrink-0 rounded-full", toneClass[tone])} />
      <span className="text-2xs text-foreground font-mono font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
    </span>
  );
}
