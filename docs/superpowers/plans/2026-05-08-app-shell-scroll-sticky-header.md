# App-shell scroll + sticky site header

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the dashboard scroll architecture from document-scroll to app-shell scroll. The viewport-locked shell makes `<SiteHeader>` stay visible without `position: sticky`, makes the `TableHeader sticky top-0` declarations actually stick, and preserves the inset card framing.

**Architecture:** `<SidebarProvider>` is height-locked to the viewport via a `className` override (`h-svh overflow-hidden`); `<SidebarInset>` becomes `min-h-0` so it can shrink past content; `<main>` becomes `flex-1 overflow-auto min-h-0`, the single scroll region. Table containers drop their redundant vertical `overflow-auto` (changed to `overflow-x-auto`) so vertical scroll falls through to `<main>`, where their `sticky top-0` resolves correctly. The shadcn `Sidebar` primitive stays untouched; `prefers-reduced-motion` for sidebar width transitions is added at the CSS layer in `globals.css`.

**Tech Stack:** Next.js 16 App Router, Tailwind 4, shadcn/ui (radix-nova).

**Issue:** #24

**Branch:** `feat/app-shell-scroll`

---

### Task 1: Lock the shell to the viewport

**Files:**

- Modify: `src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 1: Pass `className` overrides to `<SidebarProvider>` and `<SidebarInset>`**

`<SidebarProvider>` defaults to `flex min-h-svh w-full`. We need it height-bounded so children can scroll independently. Pass `className="h-svh overflow-hidden"` — `tailwind-merge` keeps both `min-h-svh` and `h-svh` (different properties), and `overflow-hidden` prevents document scroll. Pass `className="min-h-0"` to `<SidebarInset>` so its `flex-1` child (`<main>`) can shrink past intrinsic content height.

- [ ] **Step 2: Make `<main>` the single scroll container**

Add `flex-1 overflow-auto min-h-0` to the `<main>` element. With the parent locked, `<main>` now owns vertical scroll. `<SiteHeader>` is its sibling and stays visible without needing `position: sticky`.

---

### Task 2: Drop redundant table-region scroll containers

**Files:**

- Modify: `src/components/contracts/contract-list-table.tsx`
- Modify: `src/components/data-table.tsx`

Both files currently wrap their `<Table>` in `className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6"`. The `overflow-auto` creates a nested scroll context with no height bound, which:

- intercepts horizontal scroll for wide tables (good) but
- creates a no-op sticky context for `<TableHeader sticky top-0>` (bad — there's nothing for the inner box to scroll past).

- [ ] **Step 1: Replace `overflow-auto` with `overflow-x-auto` in both files**

Wide tables still scroll horizontally inside the wrapper. Vertical overflow falls through to `<main>`, and `sticky top-0` on the inner `<TableHeader>` resolves against `<main>` — sticking at the top of the scroll region as intended.

Locations:

- `contract-list-table.tsx:266`
- `data-table.tsx:474`

---

### Task 3: Reduced-motion guard for sidebar width transitions

**Files:**

- Modify: `src/app/globals.css`

The shadcn `Sidebar` primitive applies `transition-[width] duration-200 ease-linear` to `[data-slot=sidebar-gap]` and `[data-slot=sidebar-container]`. This is not gated on `prefers-reduced-motion`. We add a CSS-layer guard rather than modifying the primitive.

- [ ] **Step 1: Append a `@media (prefers-reduced-motion: reduce)` rule**

Add inside the existing reduced-motion block (around globals.css:183):

```css
[data-slot="sidebar-gap"],
[data-slot="sidebar-container"] {
  transition: none !important;
}
```

`!important` is needed because the rule competes with Tailwind's utility-class specificity.

---

### Task 4: Verification

- [ ] **Step 1: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 2: Visual smoke test**

```bash
bun run dev
```

Walk through:

1. `/` (dashboard) — scroll the dashboard down; `<SiteHeader>` stays visible; the inset card top edge stays anchored under the header.
2. `/contracts` — scroll the table; column headers stick at the top of `<main>` directly below `<SiteHeader>`. Page header (`Contratos` title) scrolls away with the rows.
3. Toggle the sidebar via Cmd+B — width transitions over 200ms.
4. DevTools → emulate `prefers-reduced-motion: reduce` → toggle Cmd+B — transition snaps instantly.
5. Resize to mobile width — sidebar trigger opens the Sheet; close it; navigate via mobile menu still works.
6. Verify container queries: `data-table` should still toggle its tabs/dropdown layout at `@4xl/main`; `section-cards` should still go 2-col at `@xl/main`.

- [ ] **Step 3: Commit**

Each task above is one logical commit:

```bash
git add src/app/[locale]/(app)/layout.tsx
git commit -m "feat(layout): lock app shell to viewport, main owns scroll"

git add src/components/contracts/contract-list-table.tsx src/components/data-table.tsx
git commit -m "fix(tables): make sticky table headers actually stick"

git add src/app/globals.css
git commit -m "feat(layout): gate sidebar transitions on prefers-reduced-motion"
```

Plan file commit goes first, before any implementation:

```bash
git add docs/superpowers/plans/2026-05-08-app-shell-scroll-sticky-header.md
git commit -m "chore: app-shell scroll plan"
```

---

### Acceptance (mirrors issue #24)

- [ ] Document body no longer scrolls; only `<main>` scrolls
- [ ] `<SiteHeader>` stays visible at all scroll positions on every (app) route
- [ ] `<TableHeader>` sticks at the top of the scroll region on `/contracts` when rows overflow
- [ ] Inset card framing remains intact at all scroll positions
- [ ] Sidebar Cmd+B toggle still works; width transitions still 200ms (off under `prefers-reduced-motion`)
- [ ] Mobile sidebar Sheet still opens/closes correctly
- [ ] Container queries still fire (`@4xl/main` for data-table; `@xl/main` for section-cards)
- [ ] `bun run typecheck` clean
