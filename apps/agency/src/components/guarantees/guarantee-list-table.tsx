"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Columns3Icon,
} from "lucide-react";

import { api } from "@convex/_generated/api";
import { useWorkspace } from "@/providers/workspace";
import { Link } from "@mutav/i18n/navigation";
import { Badge } from "@mutav/ui/badge";
import { Button } from "@mutav/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@mutav/ui/dropdown-menu";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mutav/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mutav/ui/tabs";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { GUARANTEE_STATE, type UrgencyTier } from "@convex/guarantees/domain";
import { GuaranteeStateTag, StatusTag } from "@mutav/ui/guarantee-state-tag";
import type { GuaranteeState } from "@/lib/guarantees/types";

type GuaranteeListItem = {
  id: string;
  status: GuaranteeState;
  nextRenewalDate: string;
  availableCapacityCents: number;
  tenantName: string;
  creationTime: number;
  urgency: UrgencyTier;
  urgencySortKey: number;
};

export type StateTab = "all" | "expiring" | GuaranteeState;

/**
 * Tab order runs "everything → what needs attention soon → the in-force states
 * in escalation order → the two states that cover nothing". It is authored,
 * not derived from `GUARANTEE_STATES`, because the reading order is a product
 * decision; `STATE_TABS` below still ties the set to the machine.
 */
const STATE_TABS: readonly StateTab[] = [
  "all",
  "expiring",
  GUARANTEE_STATE.ACTIVE,
  GUARANTEE_STATE.IN_ARREARS,
  GUARANTEE_STATE.DEFAULT_VERIFIED,
  GUARANTEE_STATE.COVER_COMMITTED,
  GUARANTEE_STATE.IN_EVICTION,
  GUARANTEE_STATE.DRAFTED,
  GUARANTEE_STATE.CLOSED,
];

function isStateTab(value: string): value is StateTab {
  return STATE_TABS.some((tab) => tab === value);
}

function buildColumns(
  t: ReturnType<typeof useTranslations<"guaranteeList">>,
  tState: ReturnType<typeof useTranslations<"guaranteeDetails.state">>,
): ColumnDef<GuaranteeListItem>[] {
  return [
    {
      id: "publicId",
      accessorKey: "id",
      header: t("columns.publicId"),
      cell: ({ row }) => (
        <Link
          href={`/guarantees/${row.original.id}`}
          className="text-foreground font-mono hover:underline"
        >
          {row.original.id}
        </Link>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: t("columns.status"),
      cell: ({ row }) => {
        const { status, urgency } = row.original;
        if (status === GUARANTEE_STATE.ACTIVE) {
          if (urgency === "overdue")
            return <StatusTag tone="error">{t("urgency.overdue")}</StatusTag>;
          if (urgency === "expiring")
            return <StatusTag tone="expiring">{t("urgency.expiring")}</StatusTag>;
          if (urgency === "critical")
            return <StatusTag tone="caution">{t("urgency.critical")}</StatusTag>;
        }
        return <GuaranteeStateTag state={status}>{tState(status)}</GuaranteeStateTag>;
      },
      filterFn: (row, columnId, value) => row.getValue(columnId) === value,
    },
    {
      id: "tenant",
      accessorKey: "tenantName",
      header: t("columns.tenant"),
    },
    {
      id: "availableGuarantee",
      accessorKey: "availableCapacityCents",
      header: () => <div className="w-full text-right">{t("columns.availableGuarantee")}</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {formatBRLCents(row.original.availableCapacityCents)}
        </div>
      ),
    },
    {
      id: "nextRenewalDate",
      accessorKey: "nextRenewalDate",
      header: t("columns.nextRenewalDate"),
      cell: ({ row }) => formatDateBR(row.original.nextRenewalDate),
    },
    {
      id: "creationTime",
      accessorKey: "creationTime",
      header: t("columns.creationTime"),
      cell: ({ row }) => formatDateBR(new Date(row.original.creationTime).toISOString()),
    },
    {
      // Sorted on the server-computed rank so the order matches
      // `getUrgencyTier`'s severity scale, not the label's alphabet.
      id: "urgency",
      accessorKey: "urgencySortKey",
      header: t("columns.urgency"),
      cell: ({ row }) => t(`urgency.${row.original.urgency}`),
      enableHiding: true,
    },
  ];
}

type Props = {
  defaultSort?: SortingState;
  emptyStateCta?: string;
  /**
   * Controlled tab, for a caller that drives the same filter from elsewhere on
   * the page — the dashboard's lifecycle pipeline. Left off, the table owns the
   * tab itself: the standalone guarantees page has nothing to share it with.
   */
  stateTab?: StateTab;
  onStateTabChange?: (tab: StateTab) => void;
};

export function GuaranteeListTable({
  defaultSort,
  emptyStateCta,
  stateTab: controlledStateTab,
  onStateTabChange,
}: Props) {
  const t = useTranslations("guaranteeList");
  const tState = useTranslations("guaranteeDetails.state");

  const { selectedAgency, isLoading: workspaceLoading } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const referenceDate = new Date().toISOString().slice(0, 10);
  const [ownStateTab, setOwnStateTab] = React.useState<StateTab>("all");
  const stateTab = controlledStateTab ?? ownStateTab;
  const setStateTab = onStateTabChange ?? setOwnStateTab;

  const result = useQuery(
    api.guarantees.useCases.listByAgency,
    agencyId
      ? { agencyId, paginationOpts: { numItems: 200, cursor: null }, tab: stateTab, referenceDate }
      : "skip",
  );

  const data: GuaranteeListItem[] = result?.page ?? [];
  const isLoading = workspaceLoading || (agencyId !== undefined && result === undefined);
  const noAgency = !workspaceLoading && agencyId === undefined;

  const columns = React.useMemo(() => buildColumns(t, tState), [t, tState]);

  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    creationTime: false,
    urgency: false,
  });
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSort ?? [{ id: "nextRenewalDate", desc: false }],
  );
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });

  // React Compiler skips memoizing this component because TanStack Table's
  // useReactTable() returns non-memoizable functions. Acceptable — the table
  // is small and fast.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      pagination,
    },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const q = String(filterValue).toLowerCase();
      const id = (row.original.id ?? "").toLowerCase();
      const tenant = (row.original.tenantName ?? "").toLowerCase();
      return id.includes(q) || tenant.includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const tabCounts = useQuery(
    api.guarantees.useCases.getGuaranteeTabCounts,
    agencyId ? { agencyId, referenceDate } : "skip",
  );
  const counts: Record<StateTab, number> = {
    all: tabCounts?.all ?? 0,
    expiring: tabCounts?.expiring ?? 0,
    drafted: tabCounts?.drafted ?? 0,
    active: tabCounts?.active ?? 0,
    in_arrears: tabCounts?.in_arrears ?? 0,
    default_verified: tabCounts?.default_verified ?? 0,
    cover_committed: tabCounts?.cover_committed ?? 0,
    in_eviction: tabCounts?.in_eviction ?? 0,
    closed: tabCounts?.closed ?? 0,
  };

  if (isLoading) {
    return (
      <div className="text-muted-foreground px-4 py-8 text-center text-sm">{t("loading")}</div>
    );
  }

  if (noAgency) {
    return (
      <div className="text-muted-foreground px-4 py-8 text-center text-sm">
        {t("noAgencySelected")}
      </div>
    );
  }

  return (
    <Tabs
      value={stateTab}
      onValueChange={(v) => {
        if (isStateTab(v)) setStateTab(v);
      }}
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 lg:px-6">
        <TabsList>
          {STATE_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)} <Badge variant="count">{counts[tab]}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2">
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="w-[220px]"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Columns3Icon data-icon="inline-start" />
                {t("columnsButton")}
                <ChevronDownIcon data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {table
                .getAllColumns()
                .filter((col) => col.getCanHide())
                .map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    className="capitalize"
                    checked={col.getIsVisible()}
                    onCheckedChange={(value) => col.toggleVisibility(!!value)}
                  >
                    {t.has(`columns.${col.id}` as never) ? t(`columns.${col.id}` as never) : col.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <TabsContent
        value={stateTab}
        forceMount
        className="relative flex flex-col gap-4 overflow-x-auto px-4 lg:px-6"
      >
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted sticky top-0 z-10">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-muted-foreground text-sm">{t("noResults")}</span>
                      {emptyStateCta && data.length === 0 && stateTab === "all" && (
                        <Link
                          href="/guarantees/new"
                          className="text-primary text-sm font-medium hover:underline"
                        >
                          {emptyStateCta} →
                        </Link>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-4">
          <div className="text-muted-foreground hidden flex-1 text-sm lg:flex">
            {t("pagination.pageOf", {
              current: table.getState().pagination.pageIndex + 1,
              total: Math.max(1, table.getPageCount()),
            })}
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                {t("pagination.rowsPerPage")}
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger size="sm" className="w-20" id="rows-per-page">
                  <SelectValue placeholder={table.getState().pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  <SelectGroup>
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <SelectItem key={pageSize} value={`${pageSize}`}>
                        {pageSize}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                size="icon"
                className="hidden lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">{t("pagination.firstPage")}</span>
                <ChevronsLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">{t("pagination.previousPage")}</span>
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">{t("pagination.nextPage")}</span>
                <ChevronRightIcon />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="hidden lg:flex"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">{t("pagination.lastPage")}</span>
                <ChevronsRightIcon />
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}
