"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, EyeIcon, FileTextIcon, ReceiptTextIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent } from "@mutav/ui/card";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import {
  DelinquencyStatusTag,
  type DelinquencyStatus,
} from "@/components/delinquencies/delinquency-status-tag";
import { formatBRLCents } from "@/lib/contracts/format";

type DelinquencyRow = {
  propertyId: string;
  status: DelinquencyStatus;
  noticeAt: string;
  amountCents: number;
  updatedAmountCents: number;
};

const MOCK_ROWS: DelinquencyRow[] = [
  {
    propertyId: "2014489",
    status: "open",
    noticeAt: "26/11/2026 às 09:19",
    amountCents: 345862,
    updatedAmountCents: 345862,
  },
  {
    propertyId: "2052106",
    status: "open",
    noticeAt: "24/03/2026 às 18:14",
    amountCents: 1381556,
    updatedAmountCents: 1430784,
  },
  {
    propertyId: "3871005",
    status: "resolved",
    noticeAt: "30/03/2026 às 23:09",
    amountCents: 489250,
    updatedAmountCents: 545111,
  },
];

function parseNoticeDate(noticeAt: string): string {
  const [datePart] = noticeAt.split(" às ");
  const [dd, mm, yyyy] = datePart.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

export function DelinquencyPage() {
  const t = useTranslations("delinquencies");

  const [property, setProperty] = React.useState("");
  const [tenantName, setTenantName] = React.useState("");
  const [tenantCpf, setTenantCpf] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [order, setOrder] = React.useState("date");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [amountFrom, setAmountFrom] = React.useState("");
  const [amountTo, setAmountTo] = React.useState("");
  const [activeFilters, setActiveFilters] = React.useState({
    property: "",
    tenantName: "",
    tenantCpf: "",
    status: "all",
    order: "date",
    dateFrom: "",
    dateTo: "",
    amountFrom: "",
    amountTo: "",
  });

  function handleSearch() {
    setActiveFilters({
      property,
      tenantName,
      tenantCpf,
      status,
      order,
      dateFrom,
      dateTo,
      amountFrom,
      amountTo,
    });
  }

  function handleClear() {
    setProperty("");
    setTenantName("");
    setTenantCpf("");
    setStatus("all");
    setOrder("date");
    setDateFrom("");
    setDateTo("");
    setAmountFrom("");
    setAmountTo("");
    setActiveFilters({
      property: "",
      tenantName: "",
      tenantCpf: "",
      status: "all",
      order: "date",
      dateFrom: "",
      dateTo: "",
      amountFrom: "",
      amountTo: "",
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  const amountFromCents = activeFilters.amountFrom ? Number(activeFilters.amountFrom) * 100 : null;
  const amountToCents = activeFilters.amountTo ? Number(activeFilters.amountTo) * 100 : null;

  const filtered = MOCK_ROWS.filter((r) => {
    if (activeFilters.property && !r.propertyId.includes(activeFilters.property)) return false;
    if (activeFilters.status !== "all" && r.status !== activeFilters.status) return false;
    const noticeDate = parseNoticeDate(r.noticeAt);
    if (activeFilters.dateFrom && noticeDate < activeFilters.dateFrom) return false;
    if (activeFilters.dateTo && noticeDate > activeFilters.dateTo) return false;
    if (amountFromCents !== null && r.amountCents < amountFromCents) return false;
    if (amountToCents !== null && r.amountCents > amountToCents) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (activeFilters.order === "amount") return b.amountCents - a.amountCents;
    if (activeFilters.order === "status") return a.status.localeCompare(b.status);
    return parseNoticeDate(a.noticeAt).localeCompare(parseNoticeDate(b.noticeAt));
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-4 lg:px-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.property")}</Label>
                <Input
                  placeholder={t("filter.propertyPlaceholder")}
                  value={property}
                  onChange={(e) => setProperty(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.tenantName")}</Label>
                <Input
                  placeholder={t("filter.tenantNamePlaceholder")}
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.tenantCpf")}</Label>
                <Input
                  placeholder="000.000.000-00"
                  value={tenantCpf}
                  onChange={(e) => setTenantCpf(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.status")}</Label>
                <Select value={status} onValueChange={setStatus}>
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
                <Select value={order} onValueChange={setOrder}>
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
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.dateFrom")}</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.dateTo")}</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
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
                <TableHead>{t("table.col.property")}</TableHead>
                <TableHead>{t("table.col.status")}</TableHead>
                <TableHead>{t("table.col.noticeAt")}</TableHead>
                <TableHead className="text-right">{t("table.col.amount")}</TableHead>
                <TableHead className="text-right">{t("table.col.updatedAmount")}</TableHead>
                <TableHead className="text-center">{t("table.col.action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
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
                  <TableRow key={`${row.propertyId}-${row.noticeAt}`}>
                    <TableCell>
                      <Mono className="text-sm font-medium">{row.propertyId}</Mono>
                    </TableCell>
                    <TableCell>
                      <DelinquencyStatusTag status={row.status}>
                        {t(`status.${row.status}`)}
                      </DelinquencyStatusTag>
                    </TableCell>
                    <TableCell>
                      <Mono className="text-muted-foreground text-sm">{row.noticeAt}</Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm font-semibold">
                        {formatBRLCents(row.amountCents)}
                      </Mono>
                    </TableCell>
                    <TableCell className="text-right">
                      <Mono className="text-sm">{formatBRLCents(row.updatedAmountCents)}</Mono>
                    </TableCell>
                    <TableCell className="text-center">
                      <Button variant="ghost" size="icon-sm" disabled aria-label={t("table.view")}>
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
    </div>
  );
}

export function DelinquencyPageActions() {
  const t = useTranslations("delinquencies");
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
    </>
  );
}
