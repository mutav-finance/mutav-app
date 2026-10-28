import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTagTone =
  | "neutral"
  | "positive"
  | "warning"
  | "warning-strong"
  | "escalated"
  | "critical";

const dotToneClass: Record<StatusTagTone, string> = {
  neutral: "bg-text-3",
  positive: "bg-success",
  warning: "bg-warning",
  "warning-strong": "bg-warning-strong",
  escalated: "bg-escalated",
  critical: "bg-error",
};

const iconToneClass: Record<StatusTagTone, string> = {
  neutral: "text-text-3",
  positive: "text-success",
  warning: "text-warning",
  "warning-strong": "text-warning-strong",
  escalated: "text-escalated",
  critical: "text-error",
};

// The label stays in the foreground color: several swatches (orange, amber in
// dark mode) fail text contrast on a light tint, so the tone lives in the fill
// and the dot.
const fillToneClass: Record<StatusTagTone, string> = {
  neutral: "bg-text-3/15",
  positive: "bg-success/15",
  warning: "bg-warning/15",
  "warning-strong": "bg-warning-strong/15",
  escalated: "bg-escalated/15",
  critical: "bg-error/15",
};

export type StatusTagProps = {
  tone: StatusTagTone;
  children: ReactNode;
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
  labelClassName?: string;
};

export function StatusTag({
  tone,
  children,
  pulse = false,
  icon,
  className,
  labelClassName,
}: StatusTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 align-middle whitespace-nowrap",
        fillToneClass[tone],
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          dotToneClass[tone],
          pulse && "mutav-live-pulse",
        )}
      />
      {icon ? (
        <span aria-hidden className={cn("inline-flex shrink-0", iconToneClass[tone])}>
          {icon}
        </span>
      ) : null}
      <span className={cn("text-foreground text-xs font-medium", labelClassName)}>{children}</span>
    </span>
  );
}
