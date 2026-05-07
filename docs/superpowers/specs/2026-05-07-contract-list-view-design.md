---
milestone: Imobiliárias prototype
issue: "#17"
date: 2026-05-07
status: draft
scope: contract list view UI
---

# Contract list view — design

## Context

Sub-project of the Imobiliárias prototype milestone. The schema (#16) ships with two seeded contracts under two agencies; the contract details page already renders one of them. This spec covers the **list view** that lets a user browse all contracts and click into a detail page.

This spec is UI-only. Auth and per-agency scoping are handled in their own specs (#1, future).

## Decisions

### Route

New page at `/[locale]/(app)/contracts/page.tsx` (server component). The existing sidebar `Contracts` item links to `/contracts/1000001` (a hardcoded detail) — change it to `/contracts`.

The dashboard home (`/[locale]/(app)/page.tsx`) keeps its current demo content (`SectionCards`, `ChartAreaInteractive`, `DataTable` over fake `data.json`) for now. A future spec replaces it with real KPIs; that change is unrelated to this list view.

### Component strategy — copy + adapt

Copy the existing `src/components/data-table.tsx` (the shadcn dashboard-01 showcase) into a new `src/components/contracts/contract-list-table.tsx`. Strip the features that don't apply to contracts; replace columns; preserve the visual chrome.

Why copy + adapt rather than generalizing:

- The visual is the goal — the current data-table shape is what we want to look like.
- Generalizing data-table.tsx into a reusable abstraction is a 1-2 day refactor that doesn't ship a feature.
- Both components can coexist; if the dashboard home becomes real KPIs later, the original `data-table.tsx` can be deleted then.

The original `data-table.tsx` stays intact. The new component is independent.

### Data fetching

Server component pattern from CLAUDE.md → Server vs Client Components:

```tsx
// page.tsx — server component
const preloaded = await preloadQuery(api.contracts.useCases.list, {
  paginationOpts: { numItems: 50, cursor: null },
});
return <ContractListTable preloaded={preloaded} />;
```

```tsx
// contract-list-table.tsx — client component
const { page } = usePreloadedQuery(preloaded);
```

When auth lands, `list` swaps to `listByAgency` and the page reads the active agency from session.

The query already returns the lightweight `shapeContractSummary` shape (id, agencyId, status, nextRenewalDate, availableGuaranteeCents, tenantName). This shape is sufficient for every list column EXCEPT `propertyKind`, `cityUF`, and `totalRentCents`. To avoid widening the query response, the list view sticks to the fields the summary shape already provides; richer data lives on the detail page.

**Final column set** (revised based on summary shape availability):

| Column | Source | Render |
|---|---|---|
| publicId | `id` | `<Link>` to `/contracts/{id}` |
| status | `status` | colored badge |
| tenant | `tenantName` | plain text |
| availableGuarantee | `availableGuaranteeCents` | `formatBRLCents` |
| nextRenewalDate | `nextRenewalDate` | `formatDateBR` |

Five columns. Drops `propertyKind`/`cityUF`/`totalRentCents` from the original column set since they aren't in the summary shape; the detail page covers them. If we later want richer list columns, the `shapeContractSummary` helper (in `convex/contracts/useCases.ts`) is the place to widen.

### Visual chrome (kept from data-table.tsx)

- Outer Tabs container — repurposed as the status filter
- Columns visibility dropdown (`Columns3Icon` button, three-dot dropdown)
- Rounded-border table with `bg-muted` sticky header
- Pagination footer: rows-per-page Select + "Page X of Y" + four nav buttons (first/prev/next/last)
- Sortable column headers via TanStack Table's `getSortedRowModel`

### Visual chrome (dropped)

- DnD reordering: `DndContext`, `SortableContext`, `DragHandle`, `DraggableRow`. Contracts have a natural sort order (date, status); user-defined ordering doesn't apply.
- Selection checkboxes: bulk actions are out of scope for v1.
- `TableCellViewer` drawer with embedded chart and edit form. Replaced by a `<Link>` to the existing `/contracts/{id}` detail page.
- Inline editable `target` / `limit` inputs and the saving toast.
- `reviewer` Select dropdown. Not a contract concept.
- Per-row actions kebab (`EllipsisVerticalIcon` dropdown). Defer until we have actual actions to attach.
- "Add Section" / "Add Contract" button placeholder. Contract creation is issue #6 — leave the button out entirely for now rather than disabled.

### Status filter via tabs

The original DataTable uses 4 tabs (Outline / Past Performance / Key Personnel / Focus Documents) where only Outline shows the table. For contracts, ALL tabs render the same table with a `globalFilter` or `columnFilter` predicate applied:

| Tab | Filter |
|---|---|
| Todos | none (passes through) |
| Ativo | `row.status === 'ativo'` |
| Pendente | `row.status === 'pendente'` |
| Encerrado | `row.status === 'encerrado'` |
| Cancelado | `row.status === 'cancelado'` |

Each non-Todos tab carries a count badge: `<TabsTrigger value="ativo">Ativos <Badge>{n}</Badge></TabsTrigger>`. The counts come from filtering the loaded page client-side.

Implementation: a single `<TabsContent>` block (using `value` bound to a state variable) re-renders the table with the active filter applied. No duplicating the table markup per tab.

### Search

Single text `<Input>` above the tabs, on the same row as the columns-visibility dropdown. Behavior: case-insensitive match against `publicId` OR `tenantName`. Implemented via TanStack Table `globalFilter`.

### Sort defaults

Default sort: `_creationTime` desc (newest first), per user direction. The list page item shape doesn't currently include `_creationTime`. Two options:

1. **Add `creationTime` to the summary shape** — extend `shapeContractSummary` in `convex/contracts/useCases.ts` to include `creationTime: doc._creationTime`. UI uses this for default sort.
2. **Use `nextRenewalDate` as a fallback** — already in the shape, but semantically different from "newest first".

Going with **option 1** — small backend change (one extra field), keeps the UI honest about creation order. The list query change is bounded to adding `creationTime` to the line items returned.

### Page chrome

The page wraps the table in a workspace-style header:

```
┌────────────────────────────────────────────┐
│  Contratos                                  │
│  Acompanhe os contratos da sua imobiliária  │
├────────────────────────────────────────────┤
│  [Tabs: Todos | Ativo | Pendente | ... ]    │
│  [Search input]    [Columns dropdown]       │
│                                             │
│  ┌──────────────────────────────────────┐  │
│  │ Header row (sticky)                  │  │
│  │ Row 1 ...                            │  │
│  │ Row 2 ...                            │  │
│  └──────────────────────────────────────┘  │
│                                             │
│  Rows per page  Page 1 of 1   < > >|        │
└────────────────────────────────────────────┘
```

Title and description come from i18n.

### Empty / loading / error states

- **Empty**: when zero rows match (after status filter + search), render a centered cell saying "Nenhum contrato encontrado" — uses the same `<TableRow>+<TableCell colSpan>` empty pattern the original DataTable already has, with the new key.
- **Loading**: `loading.tsx` returns a centered skeleton — page header + ~6 skeleton rows. Cheap and visual.
- **Error**: `error.tsx` (must be `"use client"`) catches segment errors. Header + retry button. Following the same shape as the existing `contracts/[id]/error.tsx`.

### i18n keys

New namespace `contractList` in both `messages/pt-BR.json` and `messages/en.json`:

```json
"contractList": {
  "meta": { "title": "Contratos | SGR", "description": "Lista de contratos da imobiliária" },
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
    "nextRenewalDate": "Próxima renovação"
  },
  "search": { "placeholder": "Buscar por ID ou locatário" },
  "columnsButton": "Colunas",
  "noResults": "Nenhum contrato encontrado",
  "loading": "Carregando contratos…",
  "error": {
    "title": "Erro ao carregar contratos",
    "description": "Não foi possível carregar a lista. Tente novamente.",
    "retry": "Tentar novamente"
  },
  "pagination": {
    "rowsPerPage": "Linhas por página",
    "pageOf": "Página {current} de {total}",
    "firstPage": "Primeira página",
    "previousPage": "Página anterior",
    "nextPage": "Próxima página",
    "lastPage": "Última página"
  },
  "a11y": {
    "selectAll": "Selecionar todas as linhas",
    "selectRow": "Selecionar linha"
  }
}
```

(The dashboard's existing `dataTable` namespace stays untouched. The `contractStatus` mapping for badge labels reuses the existing `contractDetails.status` namespace where it already exists.)

### Sidebar update

In `src/components/app-sidebar.tsx`, change:

```diff
-{ title: tMain("contracts"), href: "/contracts/1000001", icon: <FileTextIcon /> },
+{ title: tMain("contracts"), href: "/contracts", icon: <FileTextIcon /> },
```

The hardcoded link to a single contract was a placeholder — this is the moment to fix it.

## Files

```
src/app/[locale]/(app)/contracts/
├── page.tsx              (new — server component; preloadQuery)
├── loading.tsx           (new — skeleton)
├── error.tsx             (new — client; retry)
└── [id]/page.tsx         (existing — unchanged)

src/components/contracts/
├── contract-list-table.tsx   (new — client; the adapted DataTable)
└── (existing components unchanged)

src/components/app-sidebar.tsx                (modified — Contracts href)
convex/contracts/useCases.ts                  (modified — add creationTime to shapeContractSummary)
messages/pt-BR.json                           (modified — add contractList namespace)
messages/en.json                              (modified — add contractList namespace)
```

## Out of scope

- **Auth / agency scoping.** Until #1 lands, the list shows all contracts regardless of agency. The query swaps to `listByAgency` then.
- **Bulk actions** (multi-select + delete/archive). Defer until a real action exists to attach.
- **Inline editing** (target/limit inputs from the dashboard demo). Contracts are read-only in the list.
- **Per-row actions menu** (edit, archive, etc.). Defer until #6 (creation flow) lands and we know what actions matter.
- **Server-side filtering / sorting / pagination beyond what the existing query provides.** Filters and search are client-side over the loaded page (50 items default). Switch to server-side when the dataset grows.
- **Drag-and-drop reordering.** Doesn't apply to contracts.
- **Empty-state CTA** ("New contract" button). Belongs to #6.
- **Seed expansion.** The two seeded contracts are enough to demonstrate the layout, status badges, and the empty-tab state when a status has no matches. The pagination controls render even with one page.

## Acceptance criteria

- [ ] `bun run typecheck` clean
- [ ] `/contracts` route renders without errors after `bun run dev:web`
- [ ] Both seeded contracts visible (one per agency)
- [ ] Status badges render with appropriate visual treatment
- [ ] Status filter tabs filter the visible rows; counts on tabs match
- [ ] Search input filters by publicId and tenantName (case-insensitive)
- [ ] Default sort is by creation time descending
- [ ] Each row links to `/contracts/{publicId}`; clicking navigates to the existing detail page
- [ ] Sidebar `Contracts` item links to `/contracts` (no longer hardcoded to `/contracts/1000001`)
- [ ] `loading.tsx` renders briefly during navigation
- [ ] `error.tsx` catches and displays a retry UI
- [ ] All visible strings come from `messages/{pt-BR,en}.json` — no hardcoded user-facing text
- [ ] No errors in browser console

## References

- Spec: `docs/superpowers/specs/2026-05-07-imobiliarias-prototype-schema-design.md` (PR #15, merged)
- Implementation PR: #20 (merged) — schema, agencies, payments, contracts modules
- CLAUDE.md → Server vs Client Components
- CLAUDE.md → i18n (next-intl)
- CLAUDE.md → Domain conventions (Brazil) → Money
- `.claude/skills/react-component-view-model-pattern/SKILL.md`
- `.claude/skills/react-hook-composition/SKILL.md`
