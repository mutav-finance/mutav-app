"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  TrendingUpIcon,
  FileTextIcon,
  DownloadIcon,
} from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Input } from "@mutav/ui/input";
import { Mono } from "@mutav/ui/mono";
import { Skeleton } from "@mutav/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { Link } from "@mutav/i18n/navigation";
import { formatBRLCents, formatDateBR, formatMonthYear } from "@mutav/i18n/brazil";
import { useCommissionPage } from "./use-commission-page";

const SKELETON_ROW_COUNT = 5;
const TABLE_COLUMN_COUNT = 6;

export function CommissionPage() {
  const t = useTranslations("commission");
  const locale = useLocale();
  const {
    periodMonth,
    isCurrentMonth,
    goToPreviousMonth,
    goToNextMonth,
    search,
    setSearch,
    isLoading,
    totalCommissionCents,
    guaranteeCount,
    filteredRows,
  } = useCommissionPage();

  function handleExport() {
    window.print();
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4 lg:px-6">
      {/* Month navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={goToPreviousMonth} aria-label={t("prevMonth")}>
          <ChevronLeftIcon className="size-4" strokeWidth={1.5} />
        </Button>
        <span className="text-base-sm min-w-40 text-center font-mono font-medium">
          {formatMonthYear(periodMonth, locale, { month: "long", capitalize: true })}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={goToNextMonth}
          disabled={isCurrentMonth}
          aria-label={t("nextMonth")}
        >
          <ChevronRightIcon className="size-4" strokeWidth={1.5} />
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="border-b py-3">
            <Eyebrow as={CardTitle} size="xs" className="font-medium">
              {t("kpi.monthCommission")}
            </Eyebrow>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-4 py-4">
            <div className="flex items-stretch gap-3">
              <div className="bg-secondary text-muted-foreground flex shrink-0 items-center justify-center rounded px-2">
                <TrendingUpIcon className="size-6" strokeWidth={1.25} />
              </div>
              {isLoading ? (
                <div className="flex flex-col gap-2" aria-busy="true" aria-label={t("loading")}>
                  <Skeleton className="h-8 w-36" />
                  <Skeleton className="h-4 w-28" />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <Mono className="text-foreground text-2xl font-semibold">
                    {formatBRLCents(totalCommissionCents)}
                  </Mono>
                  <span className="text-muted-foreground text-sm">
                    {t("kpi.guarantees", { count: guaranteeCount })}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b py-3">
            <Eyebrow as={CardTitle} size="xs" className="font-medium">
              {t("kpi.invoice")}
            </Eyebrow>
            <CardAction>
              <Button variant="ghost" size="icon-sm" disabled aria-label={t("kpi.invoiceDownload")}>
                <DownloadIcon className="size-4" strokeWidth={1.25} />
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <div className="bg-secondary flex size-10 items-center justify-center rounded">
              <FileTextIcon className="text-muted-foreground size-5" strokeWidth={1.25} />
            </div>
            <p className="text-base-sm text-muted-foreground font-medium">
              {t("kpi.invoiceEmpty")}
            </p>
            <p className="text-muted-foreground text-sm">{t("kpi.invoiceEmptyHint")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow as="h2" size="xs" className="font-medium">
            {t("table.heading")}
          </Eyebrow>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleExport}
              aria-label={t("table.export")}
            >
              <DownloadIcon className="size-4" strokeWidth={1.25} />
            </Button>
            <div className="relative w-full max-w-xs">
              <SearchIcon
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                strokeWidth={1.25}
              />
              <Input
                placeholder={t("table.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </div>

        <div className="border-border rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.col.guarantee")}</TableHead>
                <TableHead>{t("table.col.tenant")}</TableHead>
                <TableHead className="text-right">{t("table.col.rent")}</TableHead>
                <TableHead className="text-right">{t("table.col.commission")}</TableHead>
                <TableHead className="text-center">{t("table.col.installment")}</TableHead>
                <TableHead>{t("table.col.activatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
                  <TableRow key={i} aria-hidden="true">
                    {Array.from({ length: TABLE_COLUMN_COUNT }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={TABLE_COLUMN_COUNT}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((row) => (
                  <TableRow key={row.guaranteeId}>
                    <TableCell>
                      <Link
                        href={`/guarantees/${row.guaranteeId}`}
                        className="text-primary hover:text-primary/80 font-mono text-sm font-medium transition-colors"
                      >
                        {row.guaranteeId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-base-sm">{row.tenantName}</TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm">{formatBRLCents(row.rentCents)}</Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm font-semibold">
                        {formatBRLCents(row.commissionCents)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-center">
                      <Mono className="text-muted-foreground text-sm">{row.installment}</Mono>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-muted-foreground text-sm">
                        {formatDateBR(row.activatedAt)}
                      </Mono>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
