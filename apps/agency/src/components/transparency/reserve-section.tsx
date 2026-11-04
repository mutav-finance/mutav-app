"use client";

import { useTranslations } from "next-intl";
import {
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GaugeIcon,
  LandmarkIcon,
  ScaleIcon,
  WalletIcon,
} from "lucide-react";
import type { ReserveHealthReading } from "@convex/transparency/domain";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { Mono } from "@mutav/ui/mono";
import { Skeleton } from "@mutav/ui/skeleton";
import { StatusTag, type StatusTagTone } from "@mutav/ui/status-tag";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { COVERAGE_STATE, type CoverageState, type ReserveAccountView } from "./reserve-view-model";
import { useReserveSection, type ReserveHoldingRow } from "./use-reserve-section";

const COVERAGE_TONE: Record<CoverageState, StatusTagTone> = {
  [COVERAGE_STATE.NO_REQUIREMENT]: "neutral",
  [COVERAGE_STATE.OK]: "positive",
  [COVERAGE_STATE.ATTENTION]: "warning",
  [COVERAGE_STATE.BELOW_TARGET]: "critical",
};

function ReserveMetric({
  icon,
  label,
  value,
  hint,
  tag,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  tag?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {icon}
          {label}
        </CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-2 text-2xl font-semibold tabular-nums">
          {value}
          {tag}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

function VaultLink({ href }: { href: string }) {
  const t = useTranslations("transparency.reserveHealth");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
    >
      {t("verify")}
      <ExternalLinkIcon className="size-3" />
    </a>
  );
}

function CopyAddressButton({ address }: { address: string }) {
  const t = useTranslations("transparency.reserveHealth.account");
  const { copied, copy } = useCopyToClipboard(t("copied"));
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => copy(address)}
      aria-label={t("copy")}
      title={t("copy")}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

/**
 * The account that holds the reserve funds. Its type tag and the interim note
 * come from the account kind, so moving the reserve to the MUTAV vault changes
 * the reader binding, not this copy.
 */
function ReserveAccountCard({ account }: { account: ReserveAccountView }) {
  const t = useTranslations("transparency.reserveHealth.account");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {t("title")}
          <StatusTag tone={account.interim ? "warning" : "neutral"}>
            {t(`kind.${account.kind}`)}
          </StatusTag>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Mono className="text-sm" title={account.address}>
            {account.shortAddress}
          </Mono>
          <CopyAddressButton address={account.address} />
          <VaultLink href={account.explorerUrl} />
        </div>
        {account.interim ? (
          <p className="text-muted-foreground text-sm">{t("interimNote")}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function HoldingRow({ row }: { row: ReserveHoldingRow }) {
  const t = useTranslations("transparency.reserveHealth.holdings");
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{row.label}</span>
          {row.known ? null : (
            <span className="text-muted-foreground text-xs">
              {t("unknownAsset")} · <Mono className="break-all">{row.mint}</Mono>
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.amount}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.value ?? <span className="text-muted-foreground">{t("unpriced")}</span>}
      </TableCell>
      <TableCell>
        <StatusTag tone={row.counted ? "positive" : "neutral"}>
          {row.counted ? t("counted") : t("notCounted")}
        </StatusTag>
      </TableCell>
    </TableRow>
  );
}

function ReserveSectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

function IssuerDisclosure() {
  const t = useTranslations("transparency.reserveHealth.disclosure");
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">{t("body")}</p>
      </CardContent>
    </Card>
  );
}

/**
 * The phase-1 reserve (ADR 0012): the account that holds the funds, what it holds, what counts
 * toward required coverage, and how the book stands against it. Platform-wide;
 * every viewer sees the same figures.
 */
export function ReserveSection({ reading }: { reading: ReserveHealthReading | null | undefined }) {
  const t = useTranslations("transparency.reserveHealth");
  const model = useReserveSection(reading);

  if (model.status === "loading") return <ReserveSectionSkeleton />;

  if (model.status === "unavailable") {
    return (
      <section aria-labelledby="reserve-heading" className="flex flex-col gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription id="reserve-heading" className="flex items-center gap-1.5">
              <LandmarkIcon className="size-3.5" />
              {t("title")}
            </CardDescription>
            <CardTitle className="text-muted-foreground text-base">{t("unavailable")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-xs">{t("unavailableHint")}</p>
          </CardContent>
        </Card>
        {model.account ? <ReserveAccountCard account={model.account} /> : null}
        <IssuerDisclosure />
      </section>
    );
  }

  return (
    <section aria-labelledby="reserve-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="reserve-heading" className="text-base font-semibold">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReserveMetric
          icon={<WalletIcon className="size-3.5" />}
          label={t("countedBalance")}
          value={model.countedBalance}
          hint={t("countedBalanceHint")}
        />
        <ReserveMetric
          icon={<ScaleIcon className="size-3.5" />}
          label={t("requiredCoverage")}
          value={model.requiredCoverage}
          hint={t("requiredCoverageHint", { ratio: model.requiredRatio })}
        />
        <ReserveMetric
          icon={<GaugeIcon className="size-3.5" />}
          label={t("coverageIndex")}
          value={model.achievedCoverageRatio ?? "—"}
          hint={t("coverageIndexHint")}
          tag={
            <StatusTag tone={COVERAGE_TONE[model.coverageState]}>
              {t(`coverageState.${model.coverageState}`)}
            </StatusTag>
          }
        />
        <ReserveMetric
          icon={<LandmarkIcon className="size-3.5" />}
          label={t("freeCapacity")}
          value={model.freeCapital}
          hint={t("freeCapacityHint")}
        />
      </div>

      {model.usdStablesUncounted ? (
        <p role="status" className="text-muted-foreground text-sm">
          <StatusTag tone="warning">{t("usdStablesUncountedTag")}</StatusTag>{" "}
          {t("usdStablesUncounted")}
        </p>
      ) : null}

      <ReserveAccountCard account={model.account} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("holdings.title")}</CardTitle>
          <CardDescription>{t("holdings.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("holdings.columns.asset")}</TableHead>
                <TableHead className="text-right">{t("holdings.columns.amount")}</TableHead>
                <TableHead className="text-right">{t("holdings.columns.value")}</TableHead>
                <TableHead>{t("holdings.columns.counts")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.rows.map((row) => (
                <HoldingRow key={row.key} row={row} />
              ))}
            </TableBody>
          </Table>
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <span>{t("valuation")}</span>
            <span>{t("asOf", { datetime: model.capturedAt })}</span>
          </div>
        </CardContent>
      </Card>

      <IssuerDisclosure />
    </section>
  );
}
