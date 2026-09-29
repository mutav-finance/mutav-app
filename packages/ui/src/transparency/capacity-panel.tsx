"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Skeleton } from "../skeleton";
import { formatAssetAmount, formatMultiple, formatPercent } from "./format";
import type { ReserveCoverageInput } from "./types";

/**
 * Guarantee capacity under pulse's "capacity is solvency" rule: what is left
 * is the vault's `free_capital`, and the ceiling is stable assets ÷ the
 * policy's coverage ratio `c`. There is no configured cap — the book grows
 * exactly as far as on-chain capital backs it.
 *
 * Shared by the agency `/transparency` page and the admin `/treasury` screen;
 * reads the `transparency.capacity` namespace.
 */
export function CapacityPanel({ coverage }: { coverage: ReserveCoverageInput }) {
  const t = useTranslations("transparency.capacity");
  const locale = useLocale();
  const loading = coverage === null || coverage === undefined;
  const solvency = coverage?.available ? coverage.solvency : null;
  const utilizationPct =
    solvency?.capacityUtilization === null || solvency?.capacityUtilization === undefined
      ? 0
      : Math.min(solvency.capacityUtilization * 100, 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{t("label")}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : solvency ? (
            formatAssetAmount(locale, solvency.remainingCapacity, solvency.assetSymbol)
          ) : (
            <span className="text-muted-foreground text-base">{t("unavailable")}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {loading ? (
          <Skeleton className="h-3 w-full rounded-full" />
        ) : solvency ? (
          <>
            <div
              className="bg-muted h-3 w-full overflow-hidden rounded-full"
              role="meter"
              aria-label={t("utilization")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Number(utilizationPct.toFixed(1))}
            >
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                style={{ width: `${utilizationPct.toFixed(1)}%` }}
              />
            </div>
            <dl className="text-muted-foreground flex flex-col gap-1 text-xs">
              <div className="flex justify-between gap-2">
                <dt>{t("utilization")}</dt>
                <dd className="tabular-nums">
                  {solvency.capacityUtilization === null
                    ? "—"
                    : formatPercent(locale, solvency.capacityUtilization)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("ceiling")}</dt>
                <dd className="tabular-nums">
                  {solvency.capacityCeiling === null
                    ? t("ceilingUnbounded")
                    : formatAssetAmount(locale, solvency.capacityCeiling, solvency.assetSymbol)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>{t("requiredRatio")}</dt>
                <dd className="tabular-nums">
                  {formatMultiple(locale, solvency.requiredCoverageRatio)}
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-xs">{t("rule")}</p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
