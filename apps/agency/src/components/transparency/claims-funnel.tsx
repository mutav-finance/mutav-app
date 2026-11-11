"use client";

import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { ChevronRightIcon } from "lucide-react";
import { GUARANTEE_STATE, type GuaranteeState } from "@convex/guarantees/domain";
import type { GuaranteeAggregates } from "@convex/transparency/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { cn } from "@mutav/ui/cn";
import { Skeleton } from "@mutav/ui/skeleton";
import { GUARANTEE_STATE_SWATCH_COLOR } from "@/components/guarantees/state-chart-palette";

/** The in-force states past `active`, in the order a claim walks them. */
const CLAIM_STAGES = [
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
] as const satisfies readonly GuaranteeState[];

/**
 * Where the platform's open claims sit right now. Same node as the dashboard's
 * lifecycle pipeline — accent bar in the state's tag colour, count over label,
 * an empty stage receding — but read-only: there is no table here to filter.
 */
export function ClaimsFunnel({ aggregates }: { aggregates: GuaranteeAggregates | null }) {
  const t = useTranslations("transparency.claims");
  const tState = useTranslations("guaranteeDetails.state");

  return (
    <Card className="@container/claims">
      <CardHeader>
        <CardDescription>{t("description")}</CardDescription>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-1.5 @[44rem]/claims:grid-cols-[repeat(3,minmax(0,1fr)_auto)_minmax(0,1fr)]">
          {CLAIM_STAGES.map((state, index) => (
            <Fragment key={state}>
              {index > 0 ? (
                <li
                  aria-hidden
                  className="text-muted-foreground/50 flex items-center justify-center py-0.5"
                >
                  <ChevronRightIcon className="size-4 rotate-90 @[44rem]/claims:rotate-0" />
                </li>
              ) : null}
              <li>
                {aggregates ? (
                  <ClaimStage
                    count={aggregates.countByState[state]}
                    label={tState(state)}
                    color={GUARANTEE_STATE_SWATCH_COLOR[state]}
                  />
                ) : (
                  <Skeleton className="h-[62px] w-full" />
                )}
              </li>
            </Fragment>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ClaimStage({ count, label, color }: { count: number; label: string; color: string }) {
  const isEmpty = count === 0;
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5",
        isEmpty ? "border-border/40 bg-transparent" : "bg-card",
      )}
    >
      <span
        aria-hidden
        className={cn("h-9 w-1 shrink-0 rounded-full", isEmpty && "opacity-15")}
        style={{ backgroundColor: color }}
      />
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "text-xl leading-none font-semibold tabular-nums",
            isEmpty ? "text-muted-foreground/45" : "text-foreground",
          )}
        >
          {count}
        </span>
        <span
          className={cn(
            "mt-1 text-xs leading-tight",
            isEmpty ? "text-muted-foreground/45" : "text-muted-foreground",
          )}
        >
          {label}
        </span>
      </span>
    </div>
  );
}
