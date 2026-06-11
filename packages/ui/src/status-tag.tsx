import type { ReactNode } from "react";
import { cn } from "@mutav/ui/cn";

export type StatusTagTone = "neutral" | "positive" | "warning" | "critical" | "info" | "pending";

const dotToneClass: Record<StatusTagTone, string> = {
  neutral: "bg-text-3",
  positive: "bg-success",
  warning: "bg-accent",
  critical: "bg-error",
  info: "bg-accent",
  pending: "bg-text-2",
};

const iconToneClass: Record<StatusTagTone, string> = {
  neutral: "text-text-3",
  positive: "text-success",
  warning: "text-accent",
  critical: "text-error",
  info: "text-accent",
  pending: "text-text-2",
};

export type StatusTagProps = {
  tone: StatusTagTone;
  children?: ReactNode;
  label?: string;
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
};

export function StatusTag({
  tone,
  children,
  label,
  dot = true,
  pulse = false,
  icon,
  className,
}: StatusTagProps) {
  const content = children ?? label;
  return (
    <span className={cn("inline-flex items-center gap-2 align-middle", className)}>
      {dot ? (
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            dotToneClass[tone],
            pulse && "tga-live-square",
          )}
        />
      ) : null}
      {icon ? (
        <span aria-hidden className={cn("inline-flex shrink-0", iconToneClass[tone])}>
          {icon}
        </span>
      ) : null}
      <span className="text-2xs text-text-2 font-mono font-medium tracking-[0.06em] uppercase">
        {content}
      </span>
    </span>
  );
}
