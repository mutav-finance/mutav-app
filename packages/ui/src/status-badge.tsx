import type { ReactNode } from "react";
import { cn } from "./cn";
import type { StatusTagTone } from "./status-tag";

/**
 * The tinted pill twin of `StatusTag`, for table cells where a status has to
 * be found at a glance down a column. Same five tones and dot colors, so a
 * state reads as one color on every surface. The label stays foreground-dark
 * on a light tint: orange text on white fails contrast, an orange dot on an
 * orange-tinted pill does not.
 */
const badgeToneClass: Record<StatusTagTone, string> = {
  neutral: "bg-text-3/10 border-text-3/30",
  positive: "bg-success/10 border-success/30",
  warning: "bg-warning/10 border-warning/30",
  "warning-strong": "bg-warning-strong/15 border-warning-strong/40",
  critical: "bg-error/10 border-error/30",
};

const dotToneClass: Record<StatusTagTone, string> = {
  neutral: "bg-text-3",
  positive: "bg-success",
  warning: "bg-warning",
  "warning-strong": "bg-warning-strong",
  critical: "bg-error",
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTagTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "text-foreground inline-flex h-6 items-center gap-1.5 border px-2 text-xs font-medium whitespace-nowrap",
        badgeToneClass[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0", dotToneClass[tone])} />
      {children}
    </span>
  );
}
