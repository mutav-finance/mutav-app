"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { usePaginatedQuery } from "convex/react";
import { SearchIcon, FileTextIcon, ReceiptTextIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { DelinquencyStatus } from "@convex/delinquencies/domain";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent } from "@mutav/ui/card";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { DelinquencyStatusTag } from "@/components/delinquencies/delinquency-status-tag";
import { useWorkspace } from "@/providers/workspace";
import { formatBRLCents, formatDateTimeBR } from "@/lib/contracts/format";

const STATUS_FILTERS = ["all", "open", "under_review", "provisioned", "paid", "closed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function isStatusFilter(value: string): value is StatusFilter {
  return STATUS_FILTERS.some((status) => status === value);
}

const PAGE_SIZE = 50;

type Filters = {
  contract: string;
  tenantName: string;
  status: StatusFilter;
  order: string;
  dateFrom: string;
  dateTo: string;
  amountFrom: string;
  amountTo: string;
};

export function DelinquencyPage({
  initialContractFilter = "",
}: {
  initialContractFilter?: string;
}) {
  const t = useTranslations("delinquencies");

  const [contract, setContract] = React.useState(initialContractFilter);
  const [tenantName, setTenantName] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");
  const [order, setOrder] = React.useState("date");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [amountFrom, setAmountFrom] = React.useState("");
  const [amountTo, setAmountTo] = React.useState("");
  const [activeFilters, setActiveFilters] = React.useState<Filters>({
    contract: initialContractFilter,
    tenantName: "",
    status: "all",
    order: "date",
    dateFrom: "",
    dateTo: "",
    amountFrom: "",
    amountTo: "",
  });

  const { selectedAgency, isLoading: workspaceLoading } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const serverStatus: DelinquencyStatus | undefined =
    activeFilters.status === "all" ? undefined : activeFilters.status;

  const {
    results,
    status: queryStatus,
    loadMore,
  } = usePaginatedQuery(
    api.delinquencies.useCases.listByAgency,
    agencyId ? { agencyId, ...(serverStatus ? { status: serverStatus } : {}) } : "skip",
    { initialNumItems: PAGE_SIZE },
  );

  const isLoading =
    workspaceLoading || (agencyId !== undefined && queryStatus === "LoadingFirstPage");

  function handleSearch() {
    setActiveFilters({
      contract,
      tenantName,
      status,
      order,
      dateFrom,
      dateTo,
      amountFrom,
      amountTo,
    });
  }

  function handleClear() {
    setContract("");
    setTenantName("");
    setStatus("all");
    setOrder("date");
    setDateFrom("");
    setDateTo("");
    setAmountFrom("");
    setAmountTo("");
    setActiveFilters({
      contract: "",
      tenantName: "",
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

  const filtered = results.filter((row) => {
    if (activeFilters.contract && !row.contractPublicId.includes(activeFilters.contract)) {
      return false;
    }
    if (
      activeFilters.tenantName &&
      !row.tenantFullName.toLowerCase().includes(activeFilters.tenantName.toLowerCase())
    ) {
      return false;
    }
    const openedDate = row.openedAt.slice(0, 10);
    if (activeFilters.dateFrom && openedDate < activeFilters.dateFrom) return false;
    if (activeFilters.dateTo && openedDate > activeFilters.dateTo) return false;
    if (amountFromCents !== null && row.amountCents < amountFromCents) return false;
    if (amountToCents !== null && row.amountCents > amountToCents) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (activeFilters.order === "amount") return b.amountCents - a.amountCents;
    if (activeFilters.order === "status") return a.status.localeCompare(b.status);
    return a.openedAt.localeCompare(b.openedAt);
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-4 lg:px-6">
      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">{t("filter.contract")}</Label>
                <Input
                  placeholder={t("filter.contractPlaceholder")}
                  value={contract}
                  onChange={(e) => setContract(e.target.value)}
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
                <Label className="text-xs">{t("filter.status")}</Label>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    if (isStatusFilter(value)) setStatus(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("filter.statusAll")}</SelectItem>
                    {STATUS_FILTERS.filter((s) => s !== "all").map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`status.${s}`)}
                      </SelectItem>
                    ))}
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
                <TableHead>{t("table.col.contract")}</TableHead>
                <TableHead>{t("table.col.tenant")}</TableHead>
                <TableHead>{t("table.col.status")}</TableHead>
                <TableHead>{t("table.col.openedAt")}</TableHead>
                <TableHead className="text-right">{t("table.col.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.loading")}
                  </TableCell>
                </TableRow>
              ) : sorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground py-10 text-center text-sm"
                  >
                    {t("table.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                sorted.map((row) => (
                  <TableRow key={row.publicId}>
                    <TableCell>
                      <Mono className="text-sm font-medium">{row.contractPublicId}</Mono>
                    </TableCell>
                    <TableCell className="text-sm">{row.tenantFullName}</TableCell>
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
                        {formatBRLCents(row.amountCents)}
                      </Mono>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {queryStatus === "CanLoadMore" && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" onClick={() => loadMore(PAGE_SIZE)}>
              {t("table.loadMore")}
            </Button>
          </div>
        )}
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
