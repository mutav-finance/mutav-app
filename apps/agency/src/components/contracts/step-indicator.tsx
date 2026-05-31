"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

type Props = {
  current: number;
  total: number;
};

export function StepIndicator({ current, total }: Props) {
  const t = useTranslations("contractNew");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("stepLabel", { current, total })}</p>
      <div className="flex items-center gap-2">
        {Array.from({ length: total }, (_, idx) => {
          const stepNum = idx + 1;
          const isActive = stepNum === current;
          const isDone = stepNum < current;
          return (
            <div key={stepNum} className="flex items-center gap-2">
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
                  {t(`steps.${stepNum as 1 | 2 | 3 | 4 | 5}`)}
                </span>
              </div>
              {idx < total - 1 && (
                <div
                  className={cn("h-px w-6 flex-shrink-0", isDone ? "bg-primary/40" : "bg-border")}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
