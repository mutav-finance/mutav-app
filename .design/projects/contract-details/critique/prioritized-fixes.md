# Prioritized Fixes — Contract Details

> Companion to [`critique.md`](./critique.md). Issues tagged `[STYLE]` are brand-level (run `/gsp-brand-refine`); untagged are screen-level.
> See also [`accessibility-fixes.md`](./accessibility-fixes.md) for WCAG-specific remediation.

---

## Critical (must fix before merge)

### C1. Asterisk footnote pattern is brand-imprecise and screen-reader-noisy
- **Where:** `contract-summary-card.tsx:75-77` — `<p className="text-2xs text-muted-foreground">* {t("guaranteeTooltip")}</p>`
- **Why critical:** The literal `*` glyph is read as "asterisk" by AT and reads as ASCII ornament under STYLE.md voice ("specific over general"). It also creates an undocumented footnote pattern with no anchor — there is no `*` marker on the value the footnote qualifies.
- **Fix (option A — preferred):** Promote to a real `<button>`-driven `Tooltip` on the `availableGuarantee` value:
  ```tsx
  <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" aria-label={t("guaranteeTooltipLabel")} className="inline-flex items-center gap-1">
        <Mono className="text-base font-medium text-foreground">{formatBRL(contract.availableGuaranteeBRL)}</Mono>
        <InfoIcon className="size-3.5 text-muted-foreground" weight="light" aria-hidden />
      </button>
    </TooltipTrigger>
    <TooltipContent>{t("guaranteeTooltip")}</TooltipContent>
  </Tooltip>
  ```
- **Fix (option B — minimum):** Drop the `*` glyph; render the explainer as plain `<p>` directly under the value with no ornament.
- **Add to messages:** `contractDetails.summary.guaranteeTooltipLabel` ("Detalhes da fiança disponível" / "Available guarantee details").

### C2. CardTitle elements are `<div>` — page heading hierarchy is shallow
- **Where:** every `<CardTitle>` instance across `contract-summary-card.tsx`, `contract-rental-data-card.tsx`, `contract-documents-card.tsx`, `contract-history-card.tsx`, `contract-tenant-card.tsx`. shadcn's `CardTitle` (radix-nova base) renders `<div data-slot="card-title">`.
- **Why critical:** A screen-reader user sees the page as `h1 → (no other headings)`. WCAG 1.3.1 (Info and Relationships) and 2.4.6 (Headings and Labels). Five visually-prominent section labels are not exposed as headings.
- **Fix:** Either (a) edit `src/components/ui/card.tsx` so `CardTitle` renders `<h2>` by default, or (b) at every call site pass `asChild` and wrap the children in `<h2>`. Option (a) is one file-edit and benefits every card across the app.
- **Verify:** After fix, `document.querySelectorAll('h1, h2, h3')` in DevTools should return one h1 and five h2s on the contract details route.

### C3. Skip link is styled but not rendered in `(app)/layout.tsx`
- **Where:** `src/app/[locale]/(app)/layout.tsx`. The `.skip-link` class exists at `globals.css:202-217`, but no `<a>` element references it.
- **Why critical:** Keyboard-only users must tab through the entire sidebar before reaching the contract content. WCAG 2.4.1 (Bypass Blocks).
- **Fix:**
  ```tsx
  // (app)/layout.tsx
  <SidebarInset>
    <a href="#main" className="skip-link">{t("skipToMain")}</a>
    <SiteHeader />
    <main id="main">{children}</main>
  </SidebarInset>
  ```
- Add `nav.skipToMain` translation: pt-BR "Pular para o conteúdo principal" / EN "Skip to main content".

### C4. Hero declaration multiplicity violates Bold Bet 4 [STYLE]
- **Where:** `contract-details-page.tsx:44` (hero `text-3xl` Geist Bold) + `contract-summary-card.tsx:45` (contract id `text-3xl` Geist Bold) + `contract-promo-banner.tsx:11` (promo title `text-xl` Geist Bold).
- **Why critical:** STYLE.md §6 Bold Bet 4 mandates *exactly one* Geist Bold declaration per screen. Three Geist Bolds dilute the singular page anchor.
- **Fix:**
  - Keep hero `<h1>` Geist Bold 28px as the page declaration.
  - Drop the contract id from `text-3xl` Geist Bold → render as `text-xl font-mono font-medium tabular-nums` per STYLE.md §3.1 Imobiliárias card-value spec ("JetBrains Mono Medium 16px tabular-nums" — the route uses 14–16px elsewhere; 18–20px for the prominent id is defensible).
  - Drop the promo banner title from Geist Bold → `text-base font-semibold` Inter, per its actual role (marketing prompt, not page declaration).
- **Tag:** `[STYLE]` if the brand owner agrees this is a screen-level decision; brand-level if STYLE.md needs an exception clause for "evidence anchor (contract id)."

### C5. Disabled buttons have no `aria-describedby` explanation
- **Where:** `contract-summary-card.tsx:39` (`Cancel proposal`), `contract-actions-menu.tsx:24-26` (Edit/Duplicate/Archive), `contract-documents-card.tsx:62-67` (per-slot Send).
- **Why critical:** WCAG 3.3 (Input Assistance) and Nielsen #9 (Help users diagnose) — a disabled control without explanation tells the user "you can't" but not "why" or "when you can." For state-dependent buttons (Cancel proposal might enable when contract is `pendente`), this masks the rule.
- **Fix:** Add a tooltip on each disabled control with the reason. For permanently-not-yet-built actions: `aria-describedby` linking to a single tooltip "Disponível em breve" / "Coming soon." For state-dependent: encode the reason in the localized string ("Cancel proposal — apenas para contratos pendentes").

---

## Important (high priority — same sprint)

### I1. Add `error.tsx` and `loading.tsx` segment boundaries
- **Where:** `src/app/[locale]/(app)/contracts/[id]/`
- **Why:** Today data is sync from `getContractById`, so loading is invisible and `notFound()` redirects to default Next 404. Once Convex wiring lands, neither default behaviour will be branded.
- **Fix:** Create `loading.tsx` rendering the Card skeleton stack (5 cards, each at the same height as the loaded version, with `bg-secondary` placeholder bars). Create `error.tsx` rendering a TGA-styled error card with `error.message`, a `reset()` button, and a back-to-dashboard link.

### I2. Front-aware theme not implemented [STYLE]
- **Where:** `globals.css:121-156`. `:root` = Imobiliárias light, `.dark` = Investidor dark.
- **Why:** STYLE.md treats the three fronts as distinct intensity profiles, not as a single design with a dark-mode swap. The Investidor density should be denser (closer to 6), Geist hero ceiling should be `text-6xl` (64px) not `text-3xl` (28px), and the Investidor body line-height should be 1.5 vs Imobiliárias 1.6.
- **Fix:** Drive theme by `[data-front="..."]` per STYLE.md §7, not by `.dark` alone. Wrap the app shell in `<div data-front={resolveFront(user, route)}>`. For now: add a `data-front="imobiliarias"` attribute and a sibling Investidor variant; let `next-themes` only flip light/dark within a single front. Defer Investidor and Terminal until those routes exist.
- **Tag:** `[STYLE]` — brand owner decision.

### I3. Tenant approval failure mode (`reprovado`) has no secondary signal
- **Where:** `contract-tenant-card.tsx:39-43`. `approvalTone.reprovado = "error"` paints the StatusTag square red; the label says "Reprovado." Good. But there is no follow-up inline copy ("contact tenant," "request new docs") and no `aria-live` region announcing the change.
- **Why important:** This is the most actionable status for an imobiliária — they need to know what to do next. Today the page presents the failure as a static badge.
- **Fix:** When `tenant.approvalStatus === "reprovado"`, render an additional `<p className="text-base-sm text-destructive">{t("approvalFailedHelp")}</p>` (or a dedicated alert card) explaining the next step. Add `role="status"` to the StatusTag wrapper for live updates once Convex wiring lands.

### I4. Contract id is `text-3xl` Geist Bold — not the spec for Imobiliárias card-value
- **Where:** `contract-summary-card.tsx:45-47`. Currently `font-display text-3xl font-bold tracking-tight` wrapping `<Mono>{contract.id}</Mono>`.
- **Why important:** Tied to C4. STYLE.md §3.1 Imobiliárias column says card-value font is "JetBrains Mono Medium 16px tabular-nums." The contract id is the card's central evidence; rendering it as Mono — not Geist — strengthens the brand argument and removes the duplicate declaration.
- **Fix:** `<Mono className="text-xl font-medium text-foreground">{contract.id}</Mono>` — drops Geist Bold, keeps the prominence via size.

### I5. Outline buttons in summary card don't follow Imobiliárias §3.3 secondary spec
- **Where:** `contract-summary-card.tsx:33-41`. Three outline `Button`s: open delinquency, track delinquencies, cancel proposal.
- **Why:** STYLE.md §3.3 Imobiliárias secondary is `border #C47E10` + `text #C47E10` (amber outline + amber text on white). Current shadcn `variant="outline"` ships `border-border` (`#D9D7D2`) + `text-foreground` (`#1A1A1A`), which reads as Investidor-secondary, not Imobiliárias.
- **Fix:** Either (a) edit `src/components/ui/button.tsx` `outline` variant to use `border-primary text-primary hover:bg-accent-dim` *only when* the route's front is Imobiliárias, or (b) introduce a per-front variant (`variant="outline-imob"`) and use it on Imobiliárias routes. Option (a) is cleaner if the codebase commits to `data-front`-driven theming (see I2).

### I6. Footer "TERMO APROVADO" check icon stroke width inconsistent
- **Where:** `contract-tenant-card.tsx:67-68`. `<CheckIcon className="size-4 text-success" strokeWidth={1.5} aria-hidden />`.
- **Why:** Every other lucide icon on the page ships `strokeWidth={1.25}` to approximate Phosphor's `weight="light"`. The CheckIcon at 1.5 reads visually heavier.
- **Fix:** Drop to `strokeWidth={1.25}` for consistency, or — better — migrate the route to `@phosphor-icons/react` per STYLE.md §7. Phosphor is mandated by the brand contract; lucide is a shipping compromise.

### I7. Promo banner has no `aria-label` region demoting it from main reading order
- **Where:** `contract-promo-banner.tsx:7-19`. The banner renders inside the page main flow with an `<h2>`-eligible (currently `<h2>` already, good — line 11) but no landmark.
- **Why:** Screen-reader users land on the page hero, then immediately encounter a promotional cross-sell. Without a landmark demotion, this reads as the page's first piece of content after the hero.
- **Fix:** Wrap in `<aside aria-label={t("promo.regionLabel")}>` so it's reachable via landmark navigation but not in the primary reading flow. Add `contractDetails.promo.regionLabel` ("Sugestão Quita Loft" / "Quita Loft suggestion").

---

## Polish (if time allows)

### P1. Live status pulse on contract status square
- When the contract status is `ativo`, paint the 6×6 square with the `tga-live-square` pulse class (already defined in `globals.css:163`). Not animated today; would communicate "this contract is currently active and being watched" without adding a new component.
- Already honors `prefers-reduced-motion` globally.

### P2. Copy contract id button
- Add a small icon-button next to the contract id rendering with `<CopyIcon weight="light">` that copies to clipboard. Surfaces the value's machine-precise nature and adds power-user efficiency (Nielsen #7).

### P3. Property kind icon should be Phosphor `House`
- Currently `lucide-react` `HomeIcon`. STYLE.md §4 mandates Phosphor. Migrate when the codebase swaps icon libraries (low effort, high consistency).

### P4. FieldRow numeric values should `text-align: right` on the `<dd>`
- Tabular alignment of money values benefits from right-justified columns (Bloomberg-style). Today `<dd>` is left-aligned. Optional; some teams prefer left-aligned for readability. Decision call.

### P5. Hero title fluid clamp
- `globals.css:94` ships `text-3xl` static at 28px. STYLE.md typography table specifies `text-3xl` as fluid 24→28px for Imobiliárias. Adopt the clamp value for consistency with the documented scale.

### P6. Breadcrumb separator glyph
- Default Radix breadcrumb separator is a `>` SVG. Consider a thin vertical bar `|` or a square dot to better match Precision Brutalism's geometry. Not blocking.

### P7. Tenant card avatar — replace generic UserIcon with initials
- The `size-20` UserIcon container reads as a placeholder. Replacing with `<Mono>{tenant.fullName.split(' ').map(n => n[0]).slice(0,2).join('')}</Mono>` in 28px JetBrains Mono renders the tenant as a typed identity, not a stock figure. Aligns with the brand's "no stock photography in product UI" rule.

---

## Cross-references

- [`critique.md`](./critique.md) — full evaluation
- [`accessibility-fixes.md`](./accessibility-fixes.md) — WCAG-specific items
- [`alternative-directions.md`](./alternative-directions.md) — two larger redesign directions
- Source files referenced inline above
