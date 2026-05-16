import { cn } from "@/lib/utils";

type Tone = "accent" | "success" | "error" | "neutral" | "expiring" | "caution";

const toneClass: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  error: "bg-destructive",
  neutral: "bg-muted-foreground",
  expiring: "bg-amber-500",
  caution: "bg-orange-500",
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
