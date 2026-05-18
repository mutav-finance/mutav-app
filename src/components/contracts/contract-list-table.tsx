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
import { useWorkspace } from "@/providers/workspace";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import { getUrgencyTier, urgencySortKey, type UrgencyTier } from "@/lib/contracts/urgency";
import { StatusTag } from "@/components/contracts/status-tag";
import type { ContractStatus } from "@/lib/contracts/types";

type ContractListItem = {
  id: string;
  status: ContractStatus;
  nextRenewalDate: string;
  availableGuaranteeCents: number;
  tenantName: string;
  creationTime: number;
  urgency: UrgencyTier;
  urgencySortKey: number;
};

type StatusTab = "all" | ContractStatus | "expiring";

function isStatusTab(value: string): value is StatusTab {
  return STATUS_TABS.some((tab) => tab === value);
}

const STATUS_TABS: readonly StatusTab[] = [
  "all",
  "expiring",
  "ativo",
  "pendente",
  "encerrado",
  "cancelado",
];

const statusTone: Record<ContractStatus, "accent" | "success" | "error" | "neutral"> = {
  ativo: "success",
  pendente: "accent",
  encerrado: "neutral",
  cancelado: "error",
};

function buildColumns(
  t: ReturnType<typeof useTranslations<"contractList">>,
  tStatus: ReturnType<typeof useTranslations<"contractDetails.status">>,
): ColumnDef<ContractListItem>[] {
  return [
    {
      id: "publicId",
      accessorKey: "id",
      header: t("columns.publicId"),
      cell: ({ row }) => (
        <Link
          href={`/contracts/${row.original.id}`}
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
        if (status === "ativo") {
          if (urgency === "overdue") return <StatusTag tone="error" label={t("urgency.overdue")} />;
          if (urgency === "expiring")
            return <StatusTag tone="expiring" label={t("urgency.expiring")} />;
          if (urgency === "critical")
            return <StatusTag tone="caution" label={t("urgency.critical")} />;
        }
        return <StatusTag tone={statusTone[status]} label={tStatus(status)} />;
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
      accessorKey: "availableGuaranteeCents",
      header: () => <div className="w-full text-right">{t("columns.availableGuarantee")}</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {formatBRLCents(row.original.availableGuaranteeCents)}
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
  ];
}

type Props = {
  defaultSort?: SortingState;
  emptyStateCta?: string;
};

export function ContractListTable({ defaultSort, emptyStateCta }: Props) {
  const t = useTranslations("contractList");
  const tStatus = useTranslations("contractDetails.status");

  const { selectedAgency, isLoading: workspaceLoading } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const result = useQuery(
    api.contracts.useCases.listByAgency,
    agencyId ? { agencyId, paginationOpts: { numItems: 200, cursor: null } } : "skip",
  );

  const data = React.useMemo<ContractListItem[]>(
    () =>
      (result?.page ?? []).map((c) => ({
        ...c,
        urgency: getUrgencyTier(c.status, c.nextRenewalDate),
        urgencySortKey: urgencySortKey(getUrgencyTier(c.status, c.nextRenewalDate)),
      })),
    [result],
  );
  const isLoading = workspaceLoading || (agencyId !== undefined && result === undefined);
  const noAgency = !workspaceLoading && agencyId === undefined;

  const columns = React.useMemo(() => buildColumns(t, tStatus), [t, tStatus]);

  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    creationTime: false,
  });
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSort ?? [{ id: "nextRenewalDate", desc: false }],
  );
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });
  const [statusTab, setStatusTab] = React.useState<StatusTab>("all");

  React.useEffect(() => {
    setColumnFilters((prev) => {
      const without = prev.filter((f) => f.id !== "status");
      if (statusTab === "all" || statusTab === "expiring") return without;
      return [...without, { id: "status", value: statusTab }];
    });
  }, [statusTab]);

  const tableData = React.useMemo(
    () =>
      statusTab === "expiring"
        ? data.filter((r) => r.urgency === "expiring" || r.urgency === "critical")
        : data,
    [data, statusTab],
  );

  // React Compiler skips memoizing this component because TanStack Table's
  // useReactTable() returns non-memoizable functions. Acceptable — the table
  // is small and fast.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: tableData,
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

  const counts = React.useMemo<Record<StatusTab, number>>(() => {
    const c: Record<StatusTab, number> = {
      all: data.length,
      expiring: 0,
      ativo: 0,
      pendente: 0,
      encerrado: 0,
      cancelado: 0,
    };
    for (const row of data) {
      c[row.status]++;
      if (row.urgency === "expiring" || row.urgency === "critical") c.expiring++;
    }
    return c;
  }, [data]);

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
      value={statusTab}
      onValueChange={(v) => {
        if (isStatusTab(v)) setStatusTab(v);
      }}
      className="w-full flex-col justify-start gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 lg:px-6">
        <TabsList className="**:data-[slot=badge]:bg-muted-foreground/30 **:data-[slot=badge]:size-5 **:data-[slot=badge]:rounded-full **:data-[slot=badge]:px-1">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)} <Badge variant="secondary">{counts[tab]}</Badge>
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2">
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="h-8 w-[220px]"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
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
        value={statusTab}
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
                      {emptyStateCta && data.length === 0 && statusTab === "all" && (
                        <Link
                          href="/contracts/new"
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
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">{t("pagination.firstPage")}</span>
                <ChevronsLeftIcon />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">{t("pagination.previousPage")}</span>
                <ChevronLeftIcon />
              </Button>
              <Button
                variant="outline"
                className="size-8"
                size="icon"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">{t("pagination.nextPage")}</span>
                <ChevronRightIcon />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
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
