"use client";

import { useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import { GUARANTEE_STATE } from "@convex/guarantees/domain";
import type {
  GuaranteeAggregates,
  ReserveCoverage,
  ReserveSolvency,
} from "@convex/transparency/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";
import { CapacityPanel } from "@mutav/ui/transparency/capacity-panel";
import { formatBRLCents, formatDateTimeBR } from "@mutav/i18n/brazil";
import { formatAssetAmount, formatPercent } from "@mutav/ui/transparency/format";
import { ReserveBreakdown } from "@mutav/ui/transparency/reserve-breakdown";
import { ReservePanel } from "@mutav/ui/transparency/reserve-panel";
import {
  SOLVENCY_STATUS,
  bookCapacity,
  isSnapshotStale,
  solvencyStatus,
  type SolvencyStatus,
} from "./view-model";

type Props = {
  preloadedCoverage: Preloaded<typeof api.transparency.useCases.getReserveCoverage>;
  preloadedAggregates: Preloaded<typeof api.transparency.useCases.getGuaranteeAggregates>;
};

/**
 * A4 — the treasury screen. Reuses the shared reserve / capacity / breakdown
 * panels the agency transparency page renders (same Convex queries, same
 * figures), and adds what only staff need: a solvency status, a stale-snapshot
 * warning, capacity on one raw-book scale, and the BRL exposure of the book.
 */
export function TreasuryScreen({ preloadedCoverage, preloadedAggregates }: Props) {
  const t = useTranslations("treasury");
  const coverage = usePreloadedQuery(preloadedCoverage);
  const aggregates = usePreloadedQuery(preloadedAggregates);

  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="wide">
        <div className="flex flex-col gap-4 px-4 lg:px-6">
          <ReserveStatus coverage={coverage} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ReservePanel coverage={coverage} />
            <CapacityPanel coverage={coverage} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BookCapacityCard solvency={coverage.available ? coverage.solvency : null} />
            <ExposureCard aggregates={aggregates} />
          </div>

          <ReserveBreakdown coverage={coverage} />

          <p className="text-muted-foreground text-xs">{t("footer")}</p>
        </div>
      </PageContent>
    </PageShell>
  );
}

const STATUS_TONE: Record<SolvencyStatus, StatusTagTone> = {
  [SOLVENCY_STATUS.SOLVENT]: "positive",
  [SOLVENCY_STATUS.UNDERCOVERED]: "critical",
  [SOLVENCY_STATUS.NO_BOOK]: "neutral",
  [SOLVENCY_STATUS.UNAVAILABLE]: "warning",
};

const MINUTE_MS = 60_000;

function subscribeToMinutes(onTick: () => void): () => void {
  const id = setInterval(onTick, MINUTE_MS);
  return () => clearInterval(id);
}

// Floored to the minute so the snapshot is stable between ticks, as
// `useSyncExternalStore` requires.
function currentMinute(): number {
  return Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
}

// No clock on the server render: staleness depends on the viewer's "now", and
// computing it during SSR would mismatch on hydration. The warning appears
// once the client mounts.
function noServerClock(): null {
  return null;
}

function ReserveStatus({ coverage }: { coverage: ReserveCoverage }) {
  const t = useTranslations("treasury.status");
  const now = useSyncExternalStore(subscribeToMinutes, currentMinute, noServerClock);
  const status = solvencyStatus(coverage);
  const stale =
    coverage.available && now !== null ? isSnapshotStale(coverage.capturedAt, now) : false;

  return (
    <div className="flex flex-col gap-2">
      {status ? <StatusTag tone={STATUS_TONE[status]}>{t(status)}</StatusTag> : null}
      {stale && coverage.available ? (
        <p role="status" className="text-warning text-xs">
          {t("stale", {
            datetime: formatDateTimeBR(new Date(coverage.capturedAt).toISOString()),
          })}
        </p>
      ) : null}
    </div>
  );
}

function FigureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function BookCapacityCard({ solvency }: { solvency: ReserveSolvency | null }) {
  const t = useTranslations("treasury.book");
  const locale = useLocale();
  const book = solvency ? bookCapacity(solvency) : null;
  const amount = (value: number | null) =>
    value === null || !solvency
      ? t("unbounded")
      : formatAssetAmount(locale, value, solvency.assetSymbol);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {book ? (
          <dl className="flex flex-col gap-2 text-sm">
            <FigureRow label={t("ceiling")} value={amount(book.ceiling)} />
            <FigureRow label={t("used")} value={amount(book.used)} />
            <FigureRow label={t("remaining")} value={amount(book.remaining)} />
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function ExposureCard({ aggregates }: { aggregates: GuaranteeAggregates }) {
  const t = useTranslations("treasury.exposure");
  const locale = useLocale();
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-2 text-sm">
          <FigureRow label={t("insured")} value={count(aggregates.countInsured)} />
          <FigureRow
            label={t("totalGuaranteed")}
            value={formatBRLCents(aggregates.sumInsuredCents)}
          />
          <FigureRow label={t("verifiedDefault")} value={count(aggregates.countVerifiedDefault)} />
          <FigureRow
            label={t("verifiedDefaultExposure")}
            value={formatBRLCents(aggregates.verifiedDefaultExposureCents)}
          />
          <FigureRow
            label={t("coverCommitted")}
            value={count(aggregates.countByState[GUARANTEE_STATE.COVER_COMMITTED])}
          />
          <FigureRow
            label={t("defaultRate")}
            value={
              aggregates.defaultRate === null ? "—" : formatPercent(locale, aggregates.defaultRate)
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}
