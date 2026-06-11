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
  type ColumnFiltersState,
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
import type { PaymentStateKind } from "@convex/payments/domain";
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
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import { formatPeriodMonth } from "@/lib/payments/format";
import { PaymentStateTag } from "@/components/payments/payment-state-tag";

type StateTab = "all" | PaymentStateKind;

const STATE_TABS: readonly StateTab[] = ["all", "pending", "overdue", "paid", "canceled"];

function isStateTab(value: string): value is StateTab {
  return STATE_TABS.some((tab) => tab === value);
}

type PaymentListItem = {
  id: string;
  agencyId: string;
  periodMonth: string;
  issuedAt: string;
  dueDate: string;
  totalCents: number;
  state: { kind: PaymentStateKind } & Record<string, unknown>;
  method: ({ kind: string } & Record<string, unknown>) | null;
  lineItemCount: number;
};

function buildColumns(
  t: ReturnType<typeof useTranslations<"paymentList">>,
  tState: ReturnType<typeof useTranslations<"paymentDetails.state">>,
  tMethod: ReturnType<typeof useTranslations<"paymentDetails.method">>,
): ColumnDef<PaymentListItem>[] {
  return [
    {
      id: "publicId",
      accessorKey: "id",
      header: t("columns.publicId"),
      cell: ({ row }) => (
        <Link
          href={`/payments/${row.original.id}`}
          className="text-foreground font-mono hover:underline"
        >
          {row.original.id}
        </Link>
      ),
    },
    {
      id: "period",
      accessorKey: "periodMonth",
      header: t("columns.period"),
      cell: ({ row }) => formatPeriodMonth(row.original.periodMonth),
    },
    {
      id: "dueDate",
      accessorKey: "dueDate",
      header: t("columns.dueDate"),
      cell: ({ row }) => formatDateBR(row.original.dueDate),
    },
    {
      id: "total",
      accessorKey: "totalCents",
      header: () => <div className="w-full text-right">{t("columns.total")}</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono">{formatBRLCents(row.original.totalCents)}</div>
      ),
    },
    {
      id: "state",
      accessorKey: "state",
      header: t("columns.state"),
      cell: ({ row }) => (
        <PaymentStateTag
          stateKind={row.original.state.kind}
          label={tState(row.original.state.kind)}
          pulse={row.original.state.kind === "pending" || row.original.state.kind === "overdue"}
        />
      ),
      filterFn: (row, _columnId, value) => row.original.state.kind === value,
    },
    {
      id: "contracts",
      accessorKey: "lineItemCount",
      header: t("columns.contracts"),
      cell: ({ row }) => (
        <span className="text-muted-foreground tabular-nums">{row.original.lineItemCount}</span>
      ),
    },
    {
      id: "method",
      accessorKey: "method",
      header: () => null,
      enableHiding: true,
      cell: ({ row }) => {
        const method = row.original.method;
        return (
          <span className="text-muted-foreground text-xs">
            {method ? tMethod(method.kind as "boleto" | "pix" | "stellar") : tMethod("none")}
          </span>
        );
      },
    },
  ];
}

export function PaymentListTable() {
  const t = useTranslations("paymentList");
  const tState = useTranslations("paymentDetails.state");
  const tMethod = useTranslations("paymentDetails.method");

  const { selectedAgency, isLoading: workspaceLoading } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const result = useQuery(
    api.payments.useCases.listByAgency,
    agencyId ? { agencyId, paginationOpts: { numItems: 200, cursor: null } } : "skip",
  );

  const data = React.useMemo<PaymentListItem[]>(
    () =>
      (result?.page ?? []).map((doc) => ({
        id: doc.publicId,
        agencyId: doc.agencyId,
        periodMonth: doc.periodMonth,
        issuedAt: doc.issuedAt,
        dueDate: doc.dueDate,
        totalCents: doc.totalCents,
        state: doc.state,
        method: doc.method,
        lineItemCount: doc.lineItems.length,
      })),
    [result],
  );
  const isLoading = workspaceLoading || (agencyId !== undefined && result === undefined);

  const columns = React.useMemo(() => buildColumns(t, tState, tMethod), [t, tState, tMethod]);

  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    method: false,
  });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "dueDate", desc: true }]);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });
  const [stateTab, setStateTab] = React.useState<StateTab>("all");

  React.useEffect(() => {
    setColumnFilters((prev) => {
      const without = prev.filter((f) => f.id !== "state");
      return stateTab === "all" ? without : [...without, { id: "state", value: stateTab }];
    });
  }, [stateTab]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnFilters,
      columnVisibility,
      pagination,
    },
    getRowId: (row) => row.id,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    globalFilterFn: (row, _columnId, filterValue: string) => {
      const q = String(filterValue).toLowerCase();
      const id = (row.original.id ?? "").toLowerCase();
      const period = (row.original.periodMonth ?? "").toLowerCase();
      return id.includes(q) || period.includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  const counts = React.useMemo<Record<StateTab, number>>(() => {
    const c: Record<StateTab, number> = {
      all: data.length,
      pending: 0,
      overdue: 0,
      paid: 0,
      canceled: 0,
    };
    for (const row of data) c[row.state.kind]++;
    return c;
  }, [data]);
  if (isLoading) {
    return (
      <div className="text-muted-foreground px-4 py-8 text-center text-sm">{t("loading")}</div>
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
                    {t("noResults")}
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
              <Label htmlFor="pay-rows-per-page" className="text-sm font-medium">
                {t("pagination.rowsPerPage")}
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => table.setPageSize(Number(value))}
              >
                <SelectTrigger size="sm" className="w-20" id="pay-rows-per-page">
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
