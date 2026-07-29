"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { SearchIcon, EyeIcon, FileTextIcon, ReceiptTextIcon, PlusIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent } from "@mutav/ui/card";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { usePathname, useRouter } from "@mutav/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useWorkspace } from "@/providers/workspace";
import { DelinquencyStatusTag } from "@/components/delinquencies/delinquency-status-tag";
import { OpenNoticeSheet } from "@/components/delinquencies/open-notice-sheet";
import { NoticeDetailSheet } from "@/components/delinquencies/notice-detail-sheet";
import { formatBRLCents, formatDateTimeBR } from "@/lib/contracts/format";

const OPEN_QUERY_KEY = "notice";
const OPEN_NEW = "new";
const STATUS_TABS = ["all", "open", "resolved", "canceled"] as const;
type StatusTab = (typeof STATUS_TABS)[number];

function isStatusTab(v: string): v is StatusTab {
  return STATUS_TABS.some((t) => t === v);
}

type DelinquencyRow = FunctionReturnType<
  typeof api.delinquencies.useCases.listByAgency
>["page"][number];

const SORT_KEYS = ["date", "amount", "status"] as const;
type SortKey = (typeof SORT_KEYS)[number];

function isSortKey(v: string): v is SortKey {
  return SORT_KEYS.some((k) => k === v);
}

export function DelinquencyPage() {
  const t = useTranslations("delinquencies");
  const { selectedAgency, isLoading: workspaceLoading } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const [status, setStatus] = React.useState<StatusTab>("open");
  const [order, setOrder] = React.useState<SortKey>("date");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [amountFrom, setAmountFrom] = React.useState("");
  const [amountTo, setAmountTo] = React.useState("");
  const [activeFilters, setActiveFilters] = React.useState<{
    dateFrom: string;
    dateTo: string;
    amountFrom: string;
    amountTo: string;
  }>({
    dateFrom: "",
    dateTo: "",
    amountFrom: "",
    amountTo: "",
  });

  function handleSearch() {
    setActiveFilters({ dateFrom, dateTo, amountFrom, amountTo });
  }

  function handleClear() {
    setStatus("open");
    setOrder("date");
    setDateFrom("");
    setDateTo("");
    setAmountFrom("");
    setAmountTo("");
    setActiveFilters({
      dateFrom: "",
      dateTo: "",
      amountFrom: "",
      amountTo: "",
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  const amountFromCents = activeFilters.amountFrom
    ? Math.round(Number(activeFilters.amountFrom) * 100)
    : undefined;
  const amountToCents = activeFilters.amountTo
    ? Math.round(Number(activeFilters.amountTo) * 100)
    : undefined;

  const listArgs = agencyId
    ? {
        agencyId,
        paginationOpts: { numItems: 200, cursor: null },
        ...(status !== "all" ? { status } : {}),
        ...(activeFilters.dateFrom ? { dueDateFrom: activeFilters.dateFrom } : {}),
        ...(activeFilters.dateTo ? { dueDateTo: activeFilters.dateTo } : {}),
        ...(amountFromCents != null ? { amountFromCents } : {}),
        ...(amountToCents != null ? { amountToCents } : {}),
      }
    : ("skip" as const);

  const result = useQuery(api.delinquencies.useCases.listByAgency, listArgs);

  const isLoading = workspaceLoading || (agencyId !== undefined && result === undefined);
  const noAgency = !workspaceLoading && agencyId === undefined;

  const sorted = React.useMemo<DelinquencyRow[]>(() => {
    const copy = [...(result?.page ?? [])];
    if (order === "amount") copy.sort((a, b) => b.updatedAmountCents - a.updatedAmountCents);
    else if (order === "status") copy.sort((a, b) => a.status.localeCompare(b.status));
    // Server already returns openedAt desc for the "date" default.
    return copy;
  }, [result?.page, order]);

  // URL-driven drawer state — sharable + survives navigations, and lets
  // DelinquencyPageActions (rendered up in PageHeader) trigger the open-notice
  // sheet without prop drilling.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const noticeParam = searchParams.get(OPEN_QUERY_KEY);

  function closeSheet() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete(OPEN_QUERY_KEY);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function openNoticeDetail(publicId: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(OPEN_QUERY_KEY, publicId);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-4 lg:px-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.status")}</Label>
                <Select
                  value={status}
                  onValueChange={(v) => {
                    if (isStatusTab(v)) setStatus(v);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("filter.statusAll")}</SelectItem>
                    <SelectItem value="open">{t("status.open")}</SelectItem>
                    <SelectItem value="resolved">{t("status.resolved")}</SelectItem>
                    <SelectItem value="canceled">{t("status.canceled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.order")}</Label>
                <Select
                  value={order}
                  onValueChange={(v) => {
                    if (isSortKey(v)) setOrder(v);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">{t("filter.orderDate")}</SelectItem>
                    <SelectItem value="amount">{t("filter.orderAmount")}</SelectItem>
                    <SelectItem value="status">{t("filter.orderStatus")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.dateFrom")}</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.dateTo")}</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.amountFrom")}</Label>
                <Input
                  type="number"
                  placeholder="R$ 0,00"
                  value={amountFrom}
                  onChange={(e) => setAmountFrom(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.amountTo")}</Label>
                <Input
                  type="number"
                  placeholder="R$ 0,00"
                  value={amountTo}
                  onChange={(e) => setAmountTo(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClear}>
                {t("filter.clear")}
              </Button>
              <Button onClick={handleSearch}>
                <SearchIcon className="size-4" strokeWidth={1.5} />
                {t("filter.search")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <div className="flex flex-col gap-3">
        <Eyebrow as="h2" size="xs" className="font-medium">
          {t("table.heading")}
        </Eyebrow>

        <div className="border-border rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("table.col.notice")}</TableHead>
                <TableHead>{t("table.col.status")}</TableHead>
                <TableHead>{t("table.col.noticeAt")}</TableHead>
                <TableHead className="text-right">{t("table.col.amount")}</TableHead>
                <TableHead className="text-right">{t("table.col.updatedAmount")}</TableHead>
                <TableHead className="text-center">{t("table.col.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {noAgency ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.noAgency")}
                  </TableCell>
                </TableRow>
              ) : isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.loading")}
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row) => (
                  <TableRow key={row.publicId}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => openNoticeDetail(row.publicId)}
                        className="hover:text-primary text-left"
                      >
                        <Mono className="text-sm font-medium">{row.publicId}</Mono>
                      </button>
                    </TableCell>
                    <TableCell>
                      <DelinquencyStatusTag status={row.status}>
                        {t(`status.${row.status}`)}
                      </DelinquencyStatusTag>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-muted-foreground text-sm">
                        {formatDateTimeBR(row.openedAt)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm font-semibold">
                        {formatBRLCents(row.originalAmountCents)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm">{formatBRLCents(row.updatedAmountCents)}</Mono>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openNoticeDetail(row.publicId)}
                        aria-label={t("table.view")}
                      >
                        <EyeIcon className="size-4" strokeWidth={1.25} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {agencyId ? (
        <OpenNoticeSheet
          open={noticeParam === OPEN_NEW}
          agencyId={agencyId}
          onClose={closeSheet}
          onSuccess={openNoticeDetail}
        />
      ) : null}
      <NoticeDetailSheet
        publicId={noticeParam && noticeParam !== OPEN_NEW ? noticeParam : null}
        onClose={closeSheet}
      />
    </div>
  );
}

export function DelinquencyPageActions() {
  const t = useTranslations("delinquencies");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openNew() {
    const next = new URLSearchParams(searchParams.toString());
    next.set(OPEN_QUERY_KEY, OPEN_NEW);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled>
        <FileTextIcon className="size-4" strokeWidth={1.25} />
        {t("actions.report")}
      </Button>
      <Button variant="outline" size="sm" disabled>
        <ReceiptTextIcon className="size-4" strokeWidth={1.25} />
        {t("actions.statement")}
      </Button>
      <Button size="sm" onClick={openNew}>
        <PlusIcon className="size-4" strokeWidth={1.5} />
        {t("actions.openNotice")}
      </Button>
    </>
  );
}
