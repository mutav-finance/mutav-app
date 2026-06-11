import { cn } from "@mutav/ui/cn";

export type StepIndicatorProps = {
  current: number;
  labels: readonly string[];
  progressLabel: string;
  doneSuffix: string;
  currentSuffix: string;
};

export function StepIndicator({
  current,
  labels,
  progressLabel,
  doneSuffix,
  currentSuffix,
}: StepIndicatorProps) {
  return (
    <div role="list" aria-label={progressLabel} className="flex items-center gap-2">
      {labels.map((label, idx) => {
        const step = idx + 1;
        const isActive = step === current;
        const isDone = step < current;
        return (
          <div
            key={label}
            role="listitem"
            aria-current={isActive ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <div className="flex items-center gap-1.5">
              <div
                aria-label={
                  isDone ? `${label}${doneSuffix}` : isActive ? `${label}${currentSuffix}` : label
                }
                className={cn(
                  "flex size-6 items-center justify-center font-mono text-xs font-semibold",
                  isActive && "bg-accent text-canvas",
                  isDone && "bg-accent/20 text-accent",
                  !isActive && !isDone && "bg-surface-2 text-text-3",
                )}
              >
                <span aria-hidden>{isDone ? "✓" : step}</span>
              </div>
              <span
                aria-hidden
                className={cn(
                  "hidden text-sm sm:inline",
                  isActive && "text-text font-medium",
                  isDone && "text-text-2",
                  !isActive && !isDone && "text-text-3",
                )}
              >
                {label}
              </span>
            </div>
            {idx < labels.length - 1 && (
              <div className={cn("h-px w-6 shrink-0", isDone ? "bg-accent/30" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
