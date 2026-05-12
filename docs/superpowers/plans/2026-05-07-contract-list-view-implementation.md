# Contract list view implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/contracts` route that lists contracts in a table with status-filter tabs, search, sortable columns, pagination, and row links to the existing detail page — visually matching the dashboard `data-table.tsx`.

**Architecture:** New page wraps a copy-and-adapted `data-table.tsx` (drop drag-drop / drawer / inline edits / selection / reviewer; keep tabs / sticky header / columns dropdown / pagination). Server-side `preloadQuery` + client-side `usePreloadedQuery`. Status tabs filter the loaded page; search and sort run client-side over the loaded 50 items.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, TanStack React Table v8, next-intl, shadcn/ui (radix-nova), Convex 1.35, lucide icons.

**Spec:** `docs/superpowers/specs/2026-05-07-contract-list-view-design.md`

**Issue:** #17

**Branch:** `feat/contract-list-view`

---

### Task 1: Setup — branch + plan committed

**Files:**

- Create: `docs/superpowers/plans/2026-05-07-contract-list-view-implementation.md` (this file)

- [ ] **Step 1: Confirm branch is `feat/contract-list-view`**

```bash
git rev-parse --abbrev-ref HEAD
```

Expected: `feat/contract-list-view`

- [ ] **Step 2: Commit plan**

```bash
git add docs/superpowers/plans/2026-05-07-contract-list-view-implementation.md
git commit -m "chore: contract list view implementation plan"
```

Pre-commit (typecheck + prettier on staged) should pass — only a markdown file changes.

---

### Task 2: Backend — expose `_creationTime` in `shapeContractSummary`

**Files:**

- Modify: `convex/contracts/useCases.ts` (the `shapeContractSummary` helper near the bottom)

- [ ] **Step 1: Edit `shapeContractSummary`**

Open `convex/contracts/useCases.ts`. Find:

```ts
function shapeContractSummary(doc: Contract) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    tenantName: doc.tenant.fullName,
  };
}
```

Replace with:

```ts
function shapeContractSummary(doc: Contract) {
  return {
    id: doc.publicId,
    agencyId: doc.agencyId,
    status: doc.status,
    nextRenewalDate: doc.nextRenewalDate,
    availableGuaranteeCents: doc.availableGuaranteeCents,
    tenantName: doc.tenant.fullName,
    creationTime: doc._creationTime,
  };
}
```

This adds the Convex built-in `_creationTime` (millisecond unix timestamp) to the summary, renamed to `creationTime` so consumers don't see Convex's underscore-prefix convention.

- [ ] **Step 2: Regenerate Convex types and confirm typecheck is clean**

```bash
bunx convex codegen
bun run typecheck
```

Expected: codegen completes; typecheck exits 0.

- [ ] **Step 3: Commit**

```bash
git add convex/contracts/useCases.ts convex/_generated/
git commit -m "feat(contracts): expose creationTime in list summary shape"
```

---

### Task 3: i18n — add `contractList` namespace

**Files:**

- Modify: `messages/pt-BR.json`
- Modify: `messages/en.json`

- [ ] **Step 1: Add `contractList` to `messages/pt-BR.json`**

Open `messages/pt-BR.json` and add a top-level key (insertion point: at the end of the JSON object, before the closing `}`; remember to add a comma after the previous block):

```json
"contractList": {
  "meta": {
    "title": "Contratos | SGR",
    "description": "Lista de contratos da imobiliária"
  },
  "heading": "Contratos",
  "subheading": "Acompanhe os contratos da sua imobiliária",
  "tabs": {
    "all": "Todos",
    "ativo": "Ativos",
    "pendente": "Pendentes",
    "encerrado": "Encerrados",
    "cancelado": "Cancelados"
  },
  "columns": {
    "publicId": "ID",
    "status": "Status",
    "tenant": "Locatário",
    "availableGuarantee": "Garantia disponível",
    "nextRenewalDate": "Próxima renovação",
    "creationTime": "Criado em"
  },
  "search": {
    "placeholder": "Buscar por ID ou locatário"
  },
  "columnsButton": "Colunas",
  "noResults": "Nenhum contrato encontrado",
  "loading": "Carregando contratos…",
  "errors": {
    "title": "Erro ao carregar contratos",
    "body": "Não foi possível carregar a lista. Tente novamente.",
    "retry": "Tentar novamente",
    "backToDashboard": "Voltar ao painel"
  },
  "pagination": {
    "rowsPerPage": "Linhas por página",
    "pageOf": "Página {current} de {total}",
    "firstPage": "Primeira página",
    "previousPage": "Página anterior",
    "nextPage": "Próxima página",
    "lastPage": "Última página"
  }
}
```

- [ ] **Step 2: Add the matching English block to `messages/en.json`**

```json
"contractList": {
  "meta": {
    "title": "Contracts | SGR",
    "description": "Real estate agency contracts list"
  },
  "heading": "Contracts",
  "subheading": "Track your agency's contracts",
  "tabs": {
    "all": "All",
    "ativo": "Active",
    "pendente": "Pending",
    "encerrado": "Closed",
    "cancelado": "Canceled"
  },
  "columns": {
    "publicId": "ID",
    "status": "Status",
    "tenant": "Tenant",
    "availableGuarantee": "Available guarantee",
    "nextRenewalDate": "Next renewal",
    "creationTime": "Created"
  },
  "search": {
    "placeholder": "Search by ID or tenant"
  },
  "columnsButton": "Columns",
  "noResults": "No contracts found",
  "loading": "Loading contracts…",
  "errors": {
    "title": "Could not load contracts",
    "body": "We couldn't load the list. Please try again.",
    "retry": "Try again",
    "backToDashboard": "Back to dashboard"
  },
  "pagination": {
    "rowsPerPage": "Rows per page",
    "pageOf": "Page {current} of {total}",
    "firstPage": "First page",
    "previousPage": "Previous page",
    "nextPage": "Next page",
    "lastPage": "Last page"
  }
}
```

- [ ] **Step 3: Verify both JSON files are valid + typecheck**

```bash
bun -e 'JSON.parse(require("fs").readFileSync("messages/pt-BR.json","utf8")); JSON.parse(require("fs").readFileSync("messages/en.json","utf8")); console.log("ok")'
bun run typecheck
```

Expected: prints `ok`; typecheck exits 0.

- [ ] **Step 4: Commit**

```bash
git add messages/
git commit -m "feat(i18n): add contractList namespace (pt-BR + en)"
```

---

### Task 4: Sidebar — fix the Contracts link

**Files:**

- Modify: `src/components/app-sidebar.tsx`

- [ ] **Step 1: Update the Contracts nav item**

Find the line:

```ts
{ title: tMain("contracts"), href: "/contracts/1000001", icon: <FileTextIcon /> },
```

Change `href: "/contracts/1000001"` → `href: "/contracts"`:

```ts
{ title: tMain("contracts"), href: "/contracts", icon: <FileTextIcon /> },
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/app-sidebar.tsx
git commit -m "feat(sidebar): point Contracts to the list view"
```

---

### Task 5: ContractListTable component

**Files:**

- Create: `src/components/contracts/contract-list-table.tsx`

This is the bulk of the work. Adapted from `src/components/data-table.tsx` — keeps tabs, columns dropdown, sticky header, pagination; drops drag-drop, drawer, selection, inline edits, reviewer.

- [ ] **Step 1: Create `src/components/contracts/contract-list-table.tsx`**

```tsx
"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { type Preloaded, usePreloadedQuery } from "convex/react";
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

import { type api } from "@convex/_generated/api";
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
import { StatusTag } from "@/components/contracts/status-tag";
import type { ContractStatus } from "@/lib/contracts/types";

type ContractListItem = {
  id: string;
  agencyId: string;
  status: ContractStatus;
  nextRenewalDate: string;
  availableGuaranteeCents: number;
  tenantName: string;
  creationTime: number;
};

type StatusTab = "all" | ContractStatus;

const STATUS_TABS: readonly StatusTab[] = ["all", "ativo", "pendente", "encerrado", "cancelado"];

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
      accessorKey: "status",
      header: t("columns.status"),
      cell: ({ row }) => (
        <StatusTag tone={statusTone[row.original.status]} label={tStatus(row.original.status)} />
      ),
      filterFn: (row, columnId, value) => row.getValue(columnId) === value,
    },
    {
      accessorKey: "tenantName",
      header: t("columns.tenant"),
    },
    {
      accessorKey: "availableGuaranteeCents",
      header: () => <div className="w-full text-right">{t("columns.availableGuarantee")}</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono">
          {formatBRLCents(row.original.availableGuaranteeCents)}
        </div>
      ),
    },
    {
      accessorKey: "nextRenewalDate",
      header: t("columns.nextRenewalDate"),
      cell: ({ row }) => formatDateBR(row.original.nextRenewalDate),
    },
    {
      accessorKey: "creationTime",
      header: t("columns.creationTime"),
      cell: ({ row }) => formatDateBR(new Date(row.original.creationTime).toISOString()),
    },
  ];
}

export function ContractListTable({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.contracts.useCases.list>;
}) {
  const t = useTranslations("contractList");
  const tStatus = useTranslations("contractDetails.status");

  const result = usePreloadedQuery(preloaded);
  const data = result.page as ContractListItem[];

  const columns = React.useMemo(() => buildColumns(t, tStatus), [t, tStatus]);

  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({
    creationTime: false,
  });
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "creationTime", desc: true },
  ]);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 });
  const [statusTab, setStatusTab] = React.useState<StatusTab>("all");

  React.useEffect(() => {
    setColumnFilters((prev) => {
      const without = prev.filter((f) => f.id !== "status");
      return statusTab === "all" ? without : [...without, { id: "status", value: statusTab }];
    });
  }, [statusTab]);

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
      ativo: 0,
      pendente: 0,
      encerrado: 0,
      cancelado: 0,
    };
    for (const row of data) c[row.status]++;
    return c;
  }, [data]);

  return (
    <Tabs
      value={statusTab}
      onValueChange={(v) => setStatusTab(v as StatusTab)}
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
                    {t.has(`columns.${col.id}` as never)
                      ? t(`columns.${col.id}` as never)
                      : col.id}
                  </DropdownMenuCheckboxItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <TabsContent
        value={statusTab}
        forceMount
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"
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
```

- [ ] **Step 2: Typecheck**

```bash
bun run typecheck
```

Expected: exits 0. The `Preloaded<typeof api.contracts.useCases.list>` type relies on the API having `list` registered (it does after PR #20 merged).

- [ ] **Step 3: Commit**

```bash
git add src/components/contracts/contract-list-table.tsx
git commit -m "feat(contracts): contract list table — adapted from data-table"
```

---

### Task 6: Route files — page, loading, error

**Files:**

- Create: `src/app/[locale]/(app)/contracts/page.tsx`
- Create: `src/app/[locale]/(app)/contracts/loading.tsx`
- Create: `src/app/[locale]/(app)/contracts/error.tsx`

- [ ] **Step 1: Create `src/app/[locale]/(app)/contracts/page.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { ContractListTable } from "@/components/contracts/contract-list-table";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contractList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function ContractsPage() {
  const t = await getTranslations("contractList");
  const preloaded = await preloadQuery(api.contracts.useCases.list, {
    paginationOpts: { numItems: 50, cursor: null },
  });

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-foreground text-xl font-bold tracking-tight">
          {t("heading")}
        </h1>
        <p className="text-base-sm text-muted-foreground">{t("subheading")}</p>
      </header>
      <ContractListTable preloaded={preloaded} />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/[locale]/(app)/contracts/loading.tsx`**

```tsx
import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function ContractsLoading() {
  const t = await getTranslations("contractList");
  return (
    <div
      className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6"
      aria-busy="true"
      aria-label={t("loading")}
    >
      <header className="flex flex-col gap-1">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </header>
      <Skeleton className="h-9 w-[420px] max-w-full" />
      <div className="overflow-hidden rounded-lg border">
        <div className="bg-muted h-10" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

If the project doesn't already have `@/components/ui/skeleton`, add it via shadcn — it's a standard primitive. Run `bunx shadcn@latest add skeleton` to install it (this only needs to happen once; commit any resulting `src/components/ui/skeleton.tsx`).

Verify Skeleton presence first:

```bash
test -f src/components/ui/skeleton.tsx && echo "ok" || echo "missing"
```

If `missing`: `bunx shadcn@latest add skeleton` and stage the new file alongside this commit.

- [ ] **Step 3: Create `src/app/[locale]/(app)/contracts/error.tsx`**

Mirrors the existing `src/app/[locale]/(app)/contracts/[id]/error.tsx` pattern but uses the `contractList.errors` namespace:

```tsx
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

export default function ContractsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("contractList.errors");

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 md:gap-6">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="font-display text-foreground text-xl font-bold tracking-tight">
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-4">
            <p className="text-base-sm text-muted-foreground">{t("body")}</p>
            {error.digest && (
              <p className="text-2xs text-muted-foreground font-mono tracking-[0.06em] uppercase">
                ID · {error.digest}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={reset}>{t("retry")}</Button>
              <Button
                variant="outline"
                asChild
                className="border-primary text-primary hover:bg-accent-dim hover:text-primary bg-transparent"
              >
                <Link href="/">{t("backToDashboard")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/[locale]/(app)/contracts/' src/components/ui/skeleton.tsx
git commit -m "feat(contracts): /contracts route — page, loading, error"
```

(Drop `src/components/ui/skeleton.tsx` from the `git add` if it was already present.)

---

### Task 7: Verify acceptance criteria + push + open PR

- [ ] **Step 1: Final typecheck**

```bash
bun run typecheck
```

Expected: exits 0.

- [ ] **Step 2: Push the latest Convex backend**

The `creationTime` field is needed at runtime for the table to populate. Push functions to dev:

```bash
bunx convex dev --once
```

Expected: completes without errors.

- [ ] **Step 3: Re-run seed so the dev deployment matches the new shape**

```bash
bunx convex run seed:fictionalContract
```

Expected: returns `{ agencies: [...], contracts: [...] }`.

- [ ] **Step 4: Spot-check the list query returns `creationTime`**

```bash
bunx convex run contracts/useCases:list '{"paginationOpts":{"numItems":10,"cursor":null}}'
```

Expected: each row in `page` has a numeric `creationTime` field.

- [ ] **Step 5: Boot the Next.js dev server in background and curl the page**

```bash
bun run dev:web > /tmp/mutav-dev.log 2>&1 &
echo $! > /tmp/mutav-dev.pid
until grep -q "Ready" /tmp/mutav-dev.log; do sleep 0.5; done

curl -s -o /tmp/contracts-list.html -w "HTTP %{http_code} (%{size_download} bytes)\n" http://localhost:3000/contracts
echo "Found markers:"
grep -oE 'Maria Silva Santos|João Pereira Almeida|1000001|1000002|R\$ 90\.000,00|R\$ 120\.000,00|Contratos|Próxima renovação' /tmp/contracts-list.html | sort -u
echo "Errors:"
grep -E 'TypeError|error-boundary|Failed to' /tmp/contracts-list.html | head -3
```

Expected: HTTP 200; both contract IDs (`1000001`, `1000002`) and tenant names visible; both formatted amounts; no real errors.

- [ ] **Step 6: Stop the dev server**

```bash
kill $(cat /tmp/mutav-dev.pid) 2>/dev/null
rm -f /tmp/mutav-dev.pid /tmp/contracts-list.html /tmp/mutav-dev.log
```

- [ ] **Step 7: Push branch**

```bash
git push -u origin feat/contract-list-view
```

- [ ] **Step 8: Open the PR closing #17**

```bash
gh pr create --title "feat(contracts): contract list view (closes #17)" --body "$(cat <<'EOF'
## Summary

Adds the \`/contracts\` route that lists contracts under the dashboard layout. Implements the spec from \`docs/superpowers/specs/2026-05-07-contract-list-view-design.md\`.

- New \`/contracts\` server component using \`preloadQuery\` + \`usePreloadedQuery\` (per CLAUDE.md → Server vs Client Components)
- New \`contract-list-table.tsx\` adapted from the dashboard \`data-table.tsx\` — preserves the visual chrome (tabs, sticky header, columns dropdown, pagination), drops the dashboard-only features (drag-drop, drawer with chart, inline edits, selection, reviewer)
- 6 columns: ID (links to detail) · Status (StatusTag) · Tenant · Available guarantee · Next renewal · Created (hidden by default; used for default sort)
- Status filter via tabs; client-side search by ID/tenant; sortable + paginated
- Sidebar Contracts link fixed: \`/contracts/1000001\` (hardcoded) → \`/contracts\`
- \`shapeContractSummary\` extended to expose Convex's built-in \`_creationTime\` as \`creationTime\` on each list item
- New \`contractList\` i18n namespace in pt-BR + en
- Standard \`loading.tsx\` skeleton + \`error.tsx\` retry pattern

Out of scope (handled by other issues): auth/agency scoping (#1), bulk actions, per-row action menu, "New contract" CTA (#6), server-side filter/sort/pagination, drag-drop reordering.

## Test plan

- [x] \`bun run typecheck\` clean
- [x] \`bunx convex dev --once\` deploys new shape
- [x] \`bunx convex run contracts/useCases:list ...\` returns rows with \`creationTime\`
- [x] \`/contracts\` renders with both seeded contracts visible at expected currency formatting
- [ ] Status filter tabs filter visible rows; counts match
- [ ] Search filters by ID and tenant
- [ ] Default sort is most recently created first
- [ ] Each row links to the existing detail page
- [ ] No console errors

Closes #17.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage:** every section of the spec maps to a task above. Specifically: route placement (T6), copy-and-adapt approach (T5), data fetching pattern (T6 page + T5 client), 5 visible columns + 1 hidden creationTime (T5), drop list (T5), tabs as status filter (T5), search (T5), sort defaults via creationTime (T2 + T5), page chrome (T6), empty/loading/error states (T5 inline + T6 files), i18n keys (T3), sidebar update (T4), files list matches (T1–T7).

**No placeholders:** every task contains exact file paths and complete code. The "Skeleton check" in T6 is a conditional install — explicitly handled.

**Type consistency:** `ContractListItem` shape in T5 matches the runtime shape returned by `shapeContractSummary` after T2 — same field names and types (`id: string`, `agencyId: string`, `status: ContractStatus`, `nextRenewalDate: string`, `availableGuaranteeCents: number`, `tenantName: string`, `creationTime: number`). `ContractStatus` is imported from the existing `src/lib/contracts/types.ts` (already migrated to cents in PR #20). The status tone map matches the convention from `contract-summary-card.tsx`. Tab values match `ContractStatus` literal values. Status filter `filterFn` uses literal-equality (no need to coerce).

**Pre-commit hooks:** every task leaves typecheck clean (verified at the end of each task), so commits succeed without `--no-verify`.

## Out of scope

- Tests — no test infra in the project; verification is via typecheck + manual page render in T7
- Convex `usePreloadedQuery` wrapper — the project uses raw `convex/react` `usePreloadedQuery`; future spec may wrap it (see `.claude/notes/deferred-conventions.md`)
- View-model hook split — the table component is small enough that internal `useState`/`useMemo` aren't a code-organization problem; the view-model pattern applies when complexity grows
