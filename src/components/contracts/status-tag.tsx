import { cn } from "@/lib/utils";

type Tone = "accent" | "success" | "error" | "neutral";

const toneClass: Record<Tone, string> = {
  accent: "bg-accent",
  success: "bg-success",
  error: "bg-destructive",
  neutral: "bg-muted-foreground",
};

export function StatusTag({
  tone,
  label,
  className,
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 align-middle",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn("size-[6px] shrink-0", toneClass[tone])}
      />
      <span className="font-mono text-2xs font-medium tracking-[0.06em] uppercase text-foreground">
        {label}
      </span>
    </span>
  );
}
