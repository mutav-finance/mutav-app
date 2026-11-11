"use client";

import { useTranslations } from "next-intl";
import { CheckIcon, CopyIcon, ExternalLinkIcon, LandmarkIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mutav/ui/card";
import { Mono } from "@mutav/ui/mono";
import { Skeleton } from "@mutav/ui/skeleton";
import { StatusTag } from "@mutav/ui/status-tag";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@mutav/ui/table";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { TransparencySection } from "./transparency-section";
import type { ReserveAccountView } from "./reserve-view-model";
import type { ReserveHoldingRow, ReserveSectionModel } from "./use-reserve-section";

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
        {row.share === null ? (
          <span className="text-muted-foreground block text-right">—</span>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <span className="tabular-nums">{row.share}</span>
            <span aria-hidden className="bg-muted relative h-1.5 w-16 overflow-hidden rounded-full">
              <span
                className={
                  row.counted
                    ? "bg-primary absolute inset-y-0 left-0"
                    : "bg-muted-foreground/40 absolute inset-y-0 left-0"
                }
                style={{ width: `${row.shareFraction * 100}%` }}
              />
            </span>
          </div>
        )}
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
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}

/**
 * The phase-1 reserve (ADR 0012): the account that holds the funds, what it holds, what counts
 * toward required coverage, and how the book stands against it. Platform-wide;
 * every viewer sees the same figures.
 */
export function ReserveSection({ model }: { model: ReserveSectionModel }) {
  const t = useTranslations("transparency.reserveHealth");

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
      </section>
    );
  }

  return (
    <TransparencySection id="reserve-heading" title={t("title")} description={t("description")}>
      {model.usdStablesUncounted ? (
        <p role="status" className="text-muted-foreground text-sm">
          <StatusTag tone="warning">{t("usdStablesUncountedTag")}</StatusTag>{" "}
          {t("usdStablesUncounted")}
        </p>
      ) : null}

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
                <TableHead className="text-right">{t("holdings.columns.share")}</TableHead>
                <TableHead>{t("holdings.columns.counts")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.rows.map((row) => (
                <HoldingRow key={row.key} row={row} />
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">{t("holdings.total")}</TableCell>
                <TableCell />
                <TableCell className="text-right font-medium tabular-nums">
                  {model.holdingsTotal}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {model.holdingsShare ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground font-normal">
                  {t("holdings.countedTotal", { value: model.countedBalance })}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="text-muted-foreground flex flex-col gap-1 text-xs">
            <span>{t("valuation")}</span>
            <span>{t("asOf", { datetime: model.capturedAt })}</span>
          </div>
        </CardContent>
      </Card>

      <ReserveAccountCard account={model.account} />
    </TransparencySection>
  );
}
