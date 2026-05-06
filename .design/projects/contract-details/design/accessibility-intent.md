# Accessibility Intent

What was deliberately addressed in the design as built, and what's still open.

## Deliberately handled

- **Skip-link styling** exists globally (`globals.css:202`) — though no anchor renders in the `(app)` layout (gap below).
- **Focus rings** standardized: `outline: 1px solid var(--accent)` with `outline-offset: 2px` on every focusable element via `*:focus-visible`.
- **Square-and-label status pattern** (`<StatusTag>`) — color is paired with text; status is never communicated by hue alone. Satisfies WCAG 1.4.1.
- **`aria-hidden` on decorative squares and check icons** — assistive tech reads the label, not "[bullet] [bullet]".
- **`aria-label` swaps on the history collapse trigger** — toggled between `t("collapse")` and `t("expand")` synchronized with state.
- **Localized strings** via `useTranslations`; no English fallback leaking into pt-BR.
- **`<dl>` semantics** for every label/value pair on rental, property, optional, tenant cards.
- **Single `<h1>`** on the page (the hero); cards use `<h3>`-equivalent `CardTitle` (default Radix `data-slot` paragraph — actually rendered as `<div>`, see Open).
- **Reduced-motion media query** acknowledged in `globals.css:166-169` for the live-pulse animation.

## Open / not yet addressed

### 1. Skip link missing in `(app)/layout.tsx`
The styling exists; the anchor doesn't render. To activate, add `<a href="#main" className="skip-link">Skip to main content</a>` as the first focusable child of `SidebarInset`, and ensure the page has a landmark with `id="main"`.

### 2. `CardTitle` heading semantics
shadcn's `CardTitle` defaults to a `<div>`, not an `<h2>`/`<h3>`. The page therefore has only one true heading element (`<h1>`). Five card-title-shaped section labels are not navigable by heading.
Mitigation: pass `asChild` and provide an `<h2>` element, or wrap each CardTitle in `<h2>`.

### 3. Disabled button explanation
`Cancel proposal` (summary), `Edit/Duplicate/Archive` (rental menu), `Send` (each document) — all `disabled` with no `aria-describedby` or visible reason. WCAG 3.3.1 (Error Identification) doesn't strictly require a reason on disabled controls, but Nielsen #9 (help users diagnose) does. Recommend a tooltip or inline helper.

### 4. Promo banner CTA accessibility
The CTA is plain `<Button>` text — fine. But the banner has no obvious dismissal. If it's persistent, label it `<aside aria-label={t('promo.regionLabel')}>` to demote it from main reading order on screen readers.

### 5. Asterisk footnote
`* {t("guaranteeTooltip")}` under the hero number — the `*` glyph is decorative ASCII a screen reader reads as "asterisk space". Either lift the asterisk into an `aria-hidden` span and pair it with a real `<button>` tooltip on the value, or drop the glyph and render the explainer as a plain `<p>`.

### 6. Color-on-amber CTA
The Imobiliárias amber CTA (`#C47E10` bg, `#1A1A1A` fg) = 5.3:1 — AA pass. Verified in STYLE.md §3.2 and re-asserted via the `--color-primary-foreground` override at `globals.css:135`. ✅

### 7. Dark-mode contrast not separately validated
On `.dark` (Investidor token set), every status combination needs re-checking — `--success: #3DAB72` on `--surface: #16181C` etc. Out of scope for this route's primary audit (page is Imobiliárias-first), but should be flagged.

### 8. `aria-current="page"` on breadcrumb
Radix Breadcrumb renders `BreadcrumbPage` with `aria-current="page"` automatically — verified.

### 9. Form-style labels without inputs
The `<dt>/<dd>` pattern is correct. No `<label>` wrapping non-input text — clean.

### 10. Live region for status changes
None present. Acceptable for an MVP read-only view; mandatory once realtime updates land.
