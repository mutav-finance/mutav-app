"use client";

import { useTranslations } from "next-intl";
import { GaugeIcon, LandmarkIcon, ScaleIcon, ShieldAlertIcon, WalletIcon } from "lucide-react";
import type { GuaranteeAggregates } from "@convex/transparency/domain";
import { formatBRLCents } from "@mutav/i18n/brazil";
import { Card, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { cn } from "@mutav/ui/cn";
import { Skeleton } from "@mutav/ui/skeleton";
import { StatusTag } from "@mutav/ui/status-tag";
import { InfoHint } from "./info-hint";
import { TransparencySection } from "./transparency-section";
import { COVERAGE_TONE } from "./coverage-tone";
import type { ReserveSectionModel } from "./use-reserve-section";

type Props = {
  aggregates: GuaranteeAggregates | null;
  reserve: ReserveSectionModel;
};

function SummaryFigure({
  icon,
  label,
  hint,
  value,
  tag,
  emphasis = false,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  value: React.ReactNode;
  tag?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("min-w-0", emphasis && "bg-accent/40 ring-primary/60")}>
      <CardHeader className="h-full">
        <CardDescription className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            {icon}
            {label}
            <InfoHint label={label} hint={hint} />
          </span>
          {tag}
        </CardDescription>
        <CardTitle className="mt-auto text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

/**
 * Five figures need ~76rem to sit on one line without the BRL values
 * overflowing, so the grid steps by the section's own width (5 → 3 → 2 → 1), not
 * the viewport's — the sidebar takes a varying share of the screen. Every
 * container-query prefix is written out in full: Tailwind scans source text.
 *
 * The page's answer in one row: the exposure of the book in force, what is
 * still free to guarantee, the coverage the book requires, the slice already
 * in verified default, and how many times the counted reserve meets the
 * requirement. Every figure here is also defined in
 * docs/transparency-metrics.md.
 */
export function CoverageSummary({ aggregates, reserve }: Props) {
  const t = useTranslations("transparency");
  const tReserve = useTranslations("transparency.reserveHealth");
  const tBook = useTranslations("transparency.guarantees");

  const available = reserve.status === "available" ? reserve : null;

  const reserveValue = (value: string) => {
    if (reserve.status === "loading") return <Skeleton className="h-8 w-28" />;
    if (reserve.status === "unavailable") {
      return <span className="text-muted-foreground text-base">{tReserve("unavailable")}</span>;
    }
    return value;
  };

  const bookValue = (value: string) => value || <Skeleton className="h-8 w-28" />;

  return (
    <TransparencySection
      id="summary-heading"
      title={t("summary.title")}
      description={t("summary.description")}
      contentClassName="@container/summary"
    >
      <div className="grid grid-cols-1 gap-4 @[34rem]/summary:grid-cols-2 @[50rem]/summary:grid-cols-3 @[76rem]/summary:grid-cols-5">
        <SummaryFigure
          icon={<LandmarkIcon className="size-3.5" />}
          label={tBook("totalGuaranteed")}
          hint={tBook("totalGuaranteedHint")}
          value={bookValue(aggregates ? formatBRLCents(aggregates.sumInsuredCents) : "")}
        />
        <SummaryFigure
          icon={<WalletIcon className="size-3.5" />}
          label={tReserve("freeCapacity")}
          hint={tReserve("freeCapacityHint")}
          value={reserveValue(available?.freeCapital ?? "")}
        />
        <SummaryFigure
          icon={<ScaleIcon className="size-3.5" />}
          label={tReserve("requiredCoverage")}
          hint={tReserve("requiredCoverageHint", { ratio: available?.requiredRatio ?? "—" })}
          value={reserveValue(available?.requiredCoverage ?? "")}
        />
        <SummaryFigure
          icon={<ShieldAlertIcon className="size-3.5" />}
          label={tBook("verifiedDefaultExposure")}
          hint={tBook("verifiedDefaultExposureHint", {
            count: aggregates?.countVerifiedDefault ?? 0,
          })}
          value={bookValue(
            aggregates ? formatBRLCents(aggregates.verifiedDefaultExposureCents) : "",
          )}
        />
        <SummaryFigure
          emphasis
          icon={<GaugeIcon className="size-3.5" />}
          label={tReserve("coverageIndex")}
          hint={tReserve("coverageIndexHint")}
          value={reserveValue(available?.achievedCoverageRatio ?? "—")}
          tag={
            available ? (
              <StatusTag tone={COVERAGE_TONE[available.coverageState]}>
                {tReserve(`coverageState.${available.coverageState}`)}
              </StatusTag>
            ) : null
          }
        />
      </div>

      <div className="border-border/60 text-muted-foreground flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-dashed pt-3 text-xs">
        {available ? (
          <>
            <span className="flex items-center gap-1.5">
              {tReserve("countedBalance")}
              <span className="text-foreground font-medium tabular-nums">
                {available.countedBalance}
              </span>
              <InfoHint label={tReserve("countedBalance")} hint={tReserve("countedBalanceHint")} />
            </span>
            <span>{tReserve("asOf", { datetime: available.capturedAt })}</span>
          </>
        ) : reserve.status === "unavailable" ? (
          <span>{tReserve("unavailableHint")}</span>
        ) : (
          <Skeleton className="h-4 w-48" />
        )}
      </div>
    </TransparencySection>
  );
}
