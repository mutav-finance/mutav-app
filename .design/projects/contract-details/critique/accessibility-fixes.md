# Accessibility Fixes — Contract Details

> Companion to [`accessibility-audit.md`](./accessibility-audit.md). Critical and Major items first; Minor items are advisory and can ship in a follow-up.
> Cross-reference: [`prioritized-fixes.md`](./prioritized-fixes.md) (general design fixes).

---

## Violations Table

| ID | Issue | Severity | WCAG Criterion | File | Status |
|---|---|---|---|---|---|
| A3 | Skip link styled but not rendered | **Critical** | 2.4.1 Bypass Blocks (A) | `src/app/[locale]/(app)/layout.tsx` | Open |
| A2 | `CardTitle` defaults to `<div>` — no `<h2>` headings | **Major** | 1.3.1 Info and Relationships (A), 2.4.6 Headings and Labels (AA) | `src/components/ui/card.tsx` | Open |
| A1 | Decorative icons missing `aria-hidden` | **Minor** | 1.1.1 Non-text Content (A) | `contract-rental-data-card.tsx`, `contract-tenant-card.tsx` | Open |
| A4 | Touch targets 28×28 — below 44×44 recommendation | **Minor** (advisory) | 2.5.8 Target Size (AA) — passes minimum, below recommended | shadcn `button.tsx` `size="sm"` | Advisory |
| A5 | No live regions for future status updates | **Minor** (deferred) | 4.1.3 Status Messages (AA) | `contract-summary-card.tsx`, `contract-tenant-card.tsx` | Deferred until Convex wiring |

---

## Critical

### A3 — Skip link not rendered

**Issue:** The `.skip-link` CSS class is defined globally at `globals.css:202-217`, ready to receive an anchor element. No anchor uses the class in `(app)/layout.tsx`. Keyboard-only users must tab through the entire sidebar (≈ 8 nav items) before reaching the contract content.

**WCAG criterion:** 2.4.1 Bypass Blocks (Level A — required for AA conformance).

**Severity:** Critical. Failing this criterion blocks AA conformance.

**Remediation steps:**

1. **Edit** `src/app/[locale]/(app)/layout.tsx`:

   ```tsx
   // Before:
   <SidebarInset>
     <SiteHeader />
     {children}
   </SidebarInset>

   // After:
   <SidebarInset>
     <a href="#main-content" className="skip-link">
       {tCommon("skipToMain")}
     </a>
     <SiteHeader />
     <main id="main-content">{children}</main>
   </SidebarInset>
   ```

2. **Add** translation keys to `messages/{en,pt-BR}.json` under a `common.a11y` namespace:

   ```json
   // messages/pt-BR.json
   "common": {
     "a11y": {
       "skipToMain": "Pular para o conteúdo principal"
     }
   }
   ```
   ```json
   // messages/en.json
   "common": {
     "a11y": {
       "skipToMain": "Skip to main content"
     }
   }
   ```

3. **Import** `useTranslations` (or async `getTranslations` for the server component) at the top of `(app)/layout.tsx`. Note that `(app)/layout.tsx` is currently a server component — use the client-translation hook only if you make it a client component, otherwise import `getTranslations` from `next-intl/server`.

4. **Verify** by tabbing into the page from the address bar; the first focusable element should reveal "Pular para o conteúdo principal" anchored to the top of the viewport, and pressing Enter should jump focus into the `<main>` region.

5. **Confirm** the `<main>` landmark is the only `<main>` in the route (Next layout inheritance keeps it scoped to `(app)`).

---

## Major

### A2 — CardTitle heading semantics

**Issue:** shadcn's `CardTitle` (radix-nova base) renders `<div data-slot="card-title">`. The contract details page therefore has only one heading element on the page (the `<h1>` hero). Five visually-prominent section labels — "Resumo", "Dados da Locação", "Documentos", "Histórico", "Inquilino" — are not exposed as headings to assistive technology. The page's section structure is invisible to landmark/heading navigation.

**WCAG criteria:**
- 1.3.1 Info and Relationships (A)
- 2.4.6 Headings and Labels (AA)

**Severity:** Major. The page is technically WCAG 2.2 AA compliant if section regions are exposed via other means (e.g. `<section>` with `aria-labelledby`), but the typical user expectation — and the simplest fix — is to render `CardTitle` as `<h2>`.

**Remediation steps:**

1. **Choose one of two approaches:**

   **Option (a) — global edit (recommended):** edit `src/components/ui/card.tsx` so `CardTitle` defaults to `<h2>`:

   ```tsx
   // Before:
   function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
     return (
       <div data-slot="card-title" className={cn("...", className)} {...props} />
     );
   }

   // After:
   function CardTitle({
     className,
     asChild,
     ...props
   }: React.ComponentProps<"h2"> & { asChild?: boolean }) {
     const Comp = asChild ? Slot : "h2";
     return (
       <Comp data-slot="card-title" className={cn("...", className)} {...props} />
     );
   }
   ```

   This makes every `<CardTitle>` site-wide a real heading. Consumers who need a different element can pass `asChild`.

   **Option (b) — per-call edit:** at every contract card, change `<CardTitle>...</CardTitle>` to `<CardTitle asChild><h2>...</h2></CardTitle>`. More invasive; touches 5 files.

2. **Verify** by running in the browser console: `Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => ({ level: h.tagName, text: h.textContent?.slice(0, 40) }))`. Should return one `H1` ("Contrato Ativo") and at least five `H2`s (one per card section). The promo banner already renders `<h2>` (line 11 of `contract-promo-banner.tsx`); after the fix it will be a sibling `<h2>`, not a unique heading level.

3. **Tip:** if you take option (a), audit the rest of the app (dashboard, sidebar) for any place where `CardTitle` is used to render non-heading text (e.g., a live counter that should be a `<p>`). For those, pass `asChild` and provide the correct element.

---

## Minor

### A1 — Decorative icons missing `aria-hidden`

**Issue:** Two icon-container patterns render decorative lucide icons (`HomeIcon`, `UserIcon`) next to or above their own text label. Without `aria-hidden`, AT users hear the icon's accessible name (often the icon's class name or a default) in addition to the label.

**WCAG criterion:** 1.1.1 Non-text Content (Level A).

**Severity:** Minor. lucide icons render `<svg>` elements without a `role` or `aria-label`, so most AT will skip them anyway — but explicit `aria-hidden` is the safe pattern.

**Remediation steps:**

1. **Edit** `src/components/contracts/contract-rental-data-card.tsx:35`:

   ```tsx
   // Before:
   <HomeIcon className="size-10" strokeWidth={1.25} />

   // After:
   <HomeIcon className="size-10" strokeWidth={1.25} aria-hidden />
   ```

2. **Edit** `src/components/contracts/contract-tenant-card.tsx:34, 48`:

   ```tsx
   // Both UserIcon instances:
   <UserIcon className="size-4" strokeWidth={1.25} aria-hidden />
   <UserIcon className="size-10" strokeWidth={1.25} aria-hidden />
   ```

3. **Audit** other lucide icon usages on the route. `FileTextIcon` and `UploadIcon` in `contract-documents-card.tsx` are already paired with a visible text label adjacent — add `aria-hidden` for consistency. `ChevronUpIcon`/`ChevronDownIcon` in `contract-history-card.tsx` are inside a `<Button aria-label={...}>` which already overrides the SVG's accessible name — `aria-hidden` on the icons themselves is the cleaner pattern but not strictly required.

4. **Long-term:** when migrating to Phosphor (`@phosphor-icons/react`) per STYLE.md §4, set the icon `aria-hidden` at the icon-component level rather than per-call.

---

### A4 — Touch targets below recommendation (advisory)

**Issue:** All interactive controls on the route use shadcn Button `size="sm"` (h-7 = 28px) or `size="icon-sm"` (size-7 = 28×28). This **passes** WCAG 2.2 SC 2.5.8 AA (24×24 minimum) but is **below** the widely-recommended 44×44 mobile touch-target floor.

**WCAG criterion:** 2.5.8 Target Size (AA — passes minimum).

**Severity:** Minor (advisory). Not a strict failure.

**Remediation steps (when mobile becomes a primary surface):**

1. Promote summary card buttons from `size="sm"` to `size="default"` (h-8 = 32px) — small upgrade, still below 44×44.
2. For mobile-primary screens, render at `size="lg"` (h-9 = 36px) or define a custom `size="touch"` (h-11 = 44px). Today the route is desktop-primary per BRIEF, so this is deferred.
3. Increase `gap-2` (8px) between adjacent action buttons to `gap-3` (12px) when `pointer: coarse` — improves accidental-tap resistance without changing desktop layout.

---

### A5 — No live regions for future status updates (deferred)

**Issue:** The contract status, document status, and tenant approval status surfaces are static today. When Convex wiring lands and these update in real time, screen-reader users won't be notified.

**WCAG criterion:** 4.1.3 Status Messages (AA).

**Severity:** Minor (deferred). Not applicable today; required when realtime updates land.

**Remediation steps (when realtime updates ship):**

1. **Wrap** the `StatusTag` in `contract-summary-card.tsx` with `role="status"` and `aria-live="polite"`:

   ```tsx
   <span role="status" aria-live="polite">
     <StatusTag tone={statusTone[contract.status]} label={tStatus(contract.status)} />
   </span>
   ```

2. **Apply** the same pattern to the document StatusTag (`contract-documents-card.tsx`) and the tenant approval StatusTag (`contract-tenant-card.tsx`).

3. **For history**, when a new entry is appended live: `aria-live="polite"` on the `<ol>` and prepend new entries (or use `aria-relevant="additions"` to scope announcements to the new entry only).

4. **Test** with VoiceOver: change a status via Convex dev tools, verify the status name is announced without focus moving.

---

## Verification checklist

After applying Critical (A3) and Major (A2) fixes, run through this list:

- [ ] Tab from address bar → skip link visible at top → Enter → focus jumps to main content.
- [ ] Console: `document.querySelectorAll('h1, h2').length` returns ≥ 6 (1 hero + ≥ 5 card titles).
- [ ] axe DevTools: 0 Critical, 0 Serious findings on the route.
- [ ] Lighthouse Accessibility score: 100.
- [ ] VoiceOver rotor → Headings: lists 6+ entries with the contract status as the first.
- [ ] Keyboard tab order: breadcrumb → promo CTA → 3 summary buttons → action menu trigger → 3 doc Send buttons → history collapse → (no tenant interactive controls).
- [ ] Re-verify contrast pairs at 200% browser zoom (no text clipping or contrast loss).
- [ ] Mobile reflow at 320px width: no horizontal scroll, all content readable.

After applying Minor (A1, A4) and deferred (A5) fixes, repeat the same checklist.

---

## Cross-references

- [`accessibility-audit.md`](./accessibility-audit.md) — full audit with conformance summary
- [`prioritized-fixes.md`](./prioritized-fixes.md) — non-accessibility design fixes (Critical C1–C5, Important I1–I7, Polish P1–P7)
- [`critique.md`](./critique.md) — full critique with brand contract and Nielsen scores
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
