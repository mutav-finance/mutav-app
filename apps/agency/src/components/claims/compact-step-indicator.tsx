import { cn } from "@mutav/ui/cn";
import { Eyebrow } from "@mutav/ui/eyebrow";
import type { StepIndicatorProps } from "@mutav/ui/step-indicator";

/**
 * The step indicator for narrow containers such as the case sheet: each step
 * takes an equal column with its label underneath, so every step fits at any
 * width instead of overflowing to the right like the inline `StepIndicator`.
 */
export function CompactStepIndicator({
  current,
  labels,
  progressLabel,
  doneSuffix,
  currentSuffix,
}: StepIndicatorProps) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow as="p">{progressLabel}</Eyebrow>
      <ol aria-label={progressLabel} className="flex items-start">
        {labels.map((label, idx) => {
          const step = idx + 1;
          const isActive = step === current;
          const isDone = step < current;
          return (
            <li
              key={label}
              aria-current={isActive ? "step" : undefined}
              className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
            >
              <div className="flex w-full items-center">
                <span
                  className={cn(
                    "h-px flex-1",
                    idx === 0 ? "invisible" : step <= current ? "bg-accent/30" : "bg-border",
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center font-mono text-xs font-semibold",
                    isActive && "bg-accent text-canvas",
                    isDone && "bg-accent/20 text-accent",
                    !isActive && !isDone && "bg-surface-2 text-text-3",
                  )}
                >
                  {isDone ? "✓" : step}
                </span>
                <span
                  className={cn(
                    "h-px flex-1",
                    idx === labels.length - 1 ? "invisible" : isDone ? "bg-accent/30" : "bg-border",
                  )}
                />
              </div>
              <span
                aria-hidden
                className={cn(
                  "w-full px-0.5 text-xs leading-tight break-words hyphens-auto",
                  isActive && "text-text font-medium",
                  isDone && "text-text-2",
                  !isActive && !isDone && "text-text-3",
                )}
              >
                {label}
              </span>
              <span className="sr-only">
                {isDone ? `${label}${doneSuffix}` : isActive ? `${label}${currentSuffix}` : label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
