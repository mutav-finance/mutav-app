"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Props = {
  current: 1 | 2 | 3;
  total: 3;
};

const STEP_KEYS = ["1", "2", "3"] as const;

export function StepIndicator({ current, total }: Props) {
  const t = useTranslations("contractNew");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t("stepLabel", { current, total })}
      </p>
      <div className="flex items-center gap-2">
        {STEP_KEYS.map((key, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum === current;
          const isDone = stepNum < current;
          return (
            <div key={key} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-semibold",
                    isActive && "bg-primary text-primary-foreground",
                    isDone && "bg-primary/20 text-primary",
                    !isActive && !isDone && "bg-muted text-muted-foreground",
                  )}
                >
                  {stepNum}
                </div>
                <span
                  className={cn(
                    "hidden text-sm sm:inline",
                    isActive && "text-foreground font-medium",
                    !isActive && "text-muted-foreground",
                  )}
                >
                  {t(`steps.${key}`)}
                </span>
              </div>
              {idx < 2 && (
                <div
                  className={cn(
                    "h-px w-8 flex-shrink-0",
                    isDone ? "bg-primary/40" : "bg-border",
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
