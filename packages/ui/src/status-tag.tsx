import type { ReactNode } from "react";
import { cn } from "./cn";
import { Eyebrow } from "./eyebrow";

export type StatusTagTone = "neutral" | "positive" | "warning" | "warning-strong" | "critical";

const dotToneClass: Record<StatusTagTone, string> = {
  neutral: "bg-text-3",
  positive: "bg-success",
  warning: "bg-warning",
  "warning-strong": "bg-warning-strong",
  critical: "bg-error",
};

const iconToneClass: Record<StatusTagTone, string> = {
  neutral: "text-text-3",
  positive: "text-success",
  warning: "text-warning",
  "warning-strong": "text-warning-strong",
  critical: "text-error",
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
    <span className={cn("inline-flex items-center gap-2 align-middle", className)}>
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0", dotToneClass[tone], pulse && "tga-live-pulse")}
      />
      {icon ? (
        <span aria-hidden className={cn("inline-flex shrink-0", iconToneClass[tone])}>
          {icon}
        </span>
      ) : null}
      <Eyebrow as="span" tone="default" className={labelClassName}>
        {children}
      </Eyebrow>
    </span>
  );
}
