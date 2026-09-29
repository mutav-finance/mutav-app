"use client";

import { useLocale, useTranslations } from "next-intl";
import { ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";
import { Badge } from "../badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../card";
import { Mono } from "../mono";
import { Skeleton } from "../skeleton";
import {
  formatBRLCents,
  formatBRLRate,
  formatDateTimeBRT,
  formatWallClockDateTimeBR,
} from "@mutav/i18n/brazil";
import { formatAssetAmount, formatMultiple } from "./format";
import type { ContractReferenceView, ReserveCoverageInput, ReserveSolvencyView } from "./types";

/**
 * Coverage reserve headline, coverage ratio and the reserve contract ids.
 * Shared by the agency `/transparency` page and the admin `/treasury` screen;
 * reads the `transparency.reserve` namespace, which each consuming app's
 * `messages/*.json` must carry.
 */
export function ReservePanel({ coverage }: { coverage: ReserveCoverageInput }) {
  const t = useTranslations("transparency.reserve");
  const locale = useLocale();
  const loading = coverage === null || coverage === undefined;
  const solvency = coverage?.available ? coverage.solvency : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <ShieldCheckIcon className="size-3.5" />
          {t("label")}
          {solvency?.network === "testnet" ? (
            <Badge variant="outline" className="ml-auto">
              {t("testnet")}
            </Badge>
          ) : null}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : !coverage.available ? (
            <span className="text-muted-foreground text-base">{t("unavailable")}</span>
          ) : solvency ? (
            formatAssetAmount(locale, solvency.totalAssets, solvency.assetSymbol)
          ) : (
            formatBRLCents(coverage.storedValueCents)
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <div className="flex flex-col gap-3">
            {solvency ? <SolvencyFigures solvency={solvency} /> : null}
            {coverage.available ? (
              <div className="text-muted-foreground flex flex-col gap-1 text-xs">
                <span>
                  {t("asOf", {
                    datetime: formatDateTimeBRT(new Date(coverage.capturedAt).toISOString()),
                  })}
                </span>
                {solvency ? (
                  <span>
                    {t("brlIndicative", {
                      amount: formatBRLCents(coverage.storedValueCents),
                      rate: formatBRLRate(coverage.fxUsdBrl),
                      symbol: solvency.assetSymbol,
                    })}
                  </span>
                ) : null}
                {coverage.fxQuotedAt ? (
                  <span>
                    {t("fxQuotedAt", {
                      datetime: formatWallClockDateTimeBR(coverage.fxQuotedAt),
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {solvency ? (
              <dl className="flex flex-col gap-1 text-xs">
                <ContractRow label={t("contracts.vault")} contract={solvency.contracts.vault} />
                <ContractRow label={t("contracts.policy")} contract={solvency.contracts.policy} />
                <ContractRow
                  label={t("contracts.registry")}
                  contract={solvency.contracts.registry}
                />
              </dl>
            ) : null}
            <a
              href={coverage.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              {t("viewExplorer")}
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SolvencyFigures({ solvency }: { solvency: ReserveSolvencyView }) {
  const t = useTranslations("transparency.reserve");
  const locale = useLocale();
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
      <div className="flex flex-col">
        <dt className="text-muted-foreground text-xs">{t("coverageRatio")}</dt>
        <dd className="font-semibold tabular-nums">
          {solvency.coverageRatio === null
            ? t("coverageRatioNone")
            : formatMultiple(locale, solvency.coverageRatio)}
        </dd>
      </div>
      <div className="flex flex-col">
        <dt className="text-muted-foreground text-xs">{t("coverageRequired")}</dt>
        <dd className="font-semibold tabular-nums">
          {formatAssetAmount(locale, solvency.coverageRequired, solvency.assetSymbol)}
        </dd>
      </div>
      <p className="text-muted-foreground col-span-2 text-xs">{t("coverageRatioHint")}</p>
    </dl>
  );
}

function ContractRow({ label, contract }: { label: string; contract: ContractReferenceView }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="min-w-0">
        <a
          href={contract.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          <Mono className="break-all">{contract.id}</Mono>
        </a>
      </dd>
    </div>
  );
}
