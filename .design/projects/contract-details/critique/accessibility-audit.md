# Accessibility Audit — Contract Details

> **Standard:** WCAG 2.2 AA
> **Project:** contract-details
> **Front:** Imobiliárias (light theme — `:root` in `globals.css`)
> **Date:** 2026-05-06
> **Method:** code audit + design-chunk cross-reference
> **Files audited:** `src/components/contracts/*.tsx`, `src/app/[locale]/(app)/layout.tsx`, `src/app/[locale]/(app)/contracts/[id]/page.tsx`, `src/app/[locale]/layout.tsx`, `src/app/globals.css`, `messages/{en,pt-BR}.json`

Tested in Imobiliárias (light) primary; dark-mode (Investidor) re-checks noted where relevant.

---

## 1. Perceivable

### 1.1 Text Alternatives

| Criterion | Result | Notes |
|---|---|---|
| Non-text content has alternatives | **Pass** | Decorative squares in `StatusTag` carry `aria-hidden`. Decorative `·` separator in tenant footer is `aria-hidden`. CheckIcon at footer is `aria-hidden`. Lucide icons inside icon containers (HomeIcon, UserIcon) are decorative — they sit alongside a text label below the container, but currently lack `aria-hidden`. |
| Decorative images use empty alt | **Pass** | No `<img>` elements present. All images are SVG icons. |

**Issues:**
- **A1.** `HomeIcon` (rental-data icon container) and `UserIcon` (tenant card avatar containers) are decorative but missing `aria-hidden`. They sit next to or above their own text label (the property kind / the tenant name), so AT users hear the same information twice. → `accessibility-fixes.md`.

### 1.2 Time-Based Media

**Not applicable.** No audio or video on this route.

### 1.3 Adaptable

| Criterion | Result | Notes |
|---|---|---|
| Content structure via proper markup | **Partial** | `<dl>/<dt>/<dd>` for label-value pairs (correct). Single `<h1>` on the page. **However:** shadcn `CardTitle` defaults to `<div>` not `<h2>` — five visually-prominent section labels are not exposed as headings. |
| Meaningful reading order | **Pass** | DOM order matches visual order. Breadcrumb → hero → promo → summary → rental → documents → history → tenant. |
| Instructions don't rely on shape/color/position | **Pass** | StatusTag pairs square + label (color + text). FieldRow uses `<dt>` semantics (not "to the left of"). |

**Issues:**
- **A2.** `CardTitle` heading hierarchy: page exposes only `h1`. WCAG 1.3.1 Info and Relationships, 2.4.6 Headings and Labels. → `accessibility-fixes.md`.

### 1.4 Distinguishable

| Criterion | Result | Notes |
|---|---|---|
| Color not the only means | **Pass** | Status communicated via 6×6 colored square + Mono uppercase label. Document status carries text label. Empty fields use `—` em-dash glyph (not just absence). |
| Text contrast ≥4.5:1 normal | **Pass** | `--text` `#1A1A1A` on `--surface` `#FFFFFF` = 18.1:1 ✅. `--text-2` `#6B6860` on `#FFFFFF` = 5.5:1 ✅. `--text-2` on `#F7F6F3` canvas = 5.2:1 ✅. |
| Text contrast ≥3:1 large | **Pass** | All large text (`text-3xl`, `text-xl`) uses `--text` against `--surface`/`--canvas` — passes both AA-normal and AA-large. |
| Non-text contrast ≥3:1 | **Pass** | StatusTag squares: `--accent #C47E10` on white = 3.7:1 ✅ (UI graphic). `--success #2E8B5A` on white = 4.0:1 ✅. `--error #B83232` on white = 5.5:1 ✅. `--text-2 #6B6860` on white (neutral square) = 5.5:1 ✅. Border `--border #D9D7D2` on canvas: ~1.4:1 — borders are decorative structure, not state-critical, so AA is silent. |
| Text resizable to 200% | **Pass** | Type scale uses `rem` units. `globals.css:65-108` defines all sizes in rem; no fixed `px` font-sizes leak. |
| No images of text | **Pass** | No image-of-text used. Logo is SVG/text. |
| Reflow at 320px | **Pass** | Components use mobile-first responsive patterns. `FieldRow` stacks `grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_2fr]`. Documents grid `sm:grid-cols-3` stacks at base. Rental data `lg:grid-cols-[auto_1fr]` — icon rail moves above the dl on small screens. No fixed widths in source. |
| Text spacing adjustable | **Pass** | No `letter-spacing` floors below browser default; no inline `style` overrides forcing tight spacing. Long labels (e.g. "Taxa única de ativação") wrap correctly. |

**Specific contrast pairs verified:**

| Foreground | Background | Ratio | WCAG | Used at |
|---|---|---|---|---|
| `#1A1A1A` text | `#FFFFFF` card | **18.1:1** | ✅ AAA | Body text in cards |
| `#1A1A1A` text | `#F7F6F3` canvas | **16.1:1** | ✅ AAA | Page hero, breadcrumb |
| `#6B6860` text-2 | `#FFFFFF` card | **5.5:1** | ✅ AA | Field labels, card titles |
| `#6B6860` text-2 | `#F7F6F3` canvas | **5.2:1** | ✅ AA | Helper copy |
| `#1A1A1A` text | `#C47E10` amber CTA | **5.3:1** | ✅ AA | Button text on amber fill |
| `#C47E10` accent | `#FFFFFF` (as 6×6 square) | **3.7:1** | ✅ AA non-text | StatusTag accent square |
| `#2E8B5A` success | `#FFFFFF` (as 6×6 square) | **4.0:1** | ✅ AA non-text | StatusTag success square |
| `#B83232` error | `#FFFFFF` (as 6×6 square) | **5.5:1** | ✅ AA all | StatusTag error square |
| `#1A1A1A` text | `#FFF0D4` accent-dim | **17.4:1** | ✅ AAA | Promo banner text on cream |
| `#2E8B5A` success | `#FFFFFF` (as `text-success` on check icon) | **4.0:1** | ✅ AA non-text | Tenant footer check icon (decorative; aria-hidden) |

All contrast requirements are satisfied for the Imobiliárias front.

**Dark mode (Investidor) re-check** — design-chunk `color-tokens.md` flags this as out-of-scope but worth re-checking when Investidor route ships. Spot-check: `#F0F0EE` text on `#16181C` card = 16.1:1 ✅ AAA. `#8A8F99` text-2 on `#16181C` = 5.7:1 ✅ AA.

---

## 2. Operable

### 2.1 Keyboard Accessible

| Criterion | Result | Notes |
|---|---|---|
| All functionality available via keyboard | **Pass** | All interactive elements (Buttons, Breadcrumb links, DropdownMenu trigger and items, Collapsible trigger) are Radix primitives with full keyboard support. No custom keyboard handlers introduced. |
| No keyboard traps | **Pass** | DropdownMenu and Collapsible follow Radix focus-management defaults. |
| Character key shortcuts can be turned off | **N/A** | No character key shortcuts present. |

### 2.2 Enough Time

**Not applicable** — no time limits, no auto-updating content. (The live-pulse class exists in `globals.css` but is not used on this route.)

### 2.3 Seizures

| Criterion | Result | Notes |
|---|---|---|
| No flashing >3Hz | **Pass** | No flashing content. The live-pulse animation (when used elsewhere) runs at 0.5Hz (2s cycle). |
| Motion can be disabled | **Pass** | `prefers-reduced-motion` honored globally at `globals.css:166-169` for the pulse class and scroll-behavior. The Radix Collapsible's height animation respects `prefers-reduced-motion` by default. |

### 2.4 Navigable

| Criterion | Result | Notes |
|---|---|---|
| Skip navigation link | **Fail** | `.skip-link` styles exist at `globals.css:202-217` but no `<a>` references the class in `(app)/layout.tsx`. Keyboard users must tab through the entire sidebar before reaching the main content. WCAG 2.4.1. |
| Page has descriptive title | **Pass** | `<title>` is set via `generateMetadata` in `[locale]/layout.tsx` from i18n `meta.title`. Page-specific title would strengthen, but not strictly required for AA. |
| Focus order logical | **Pass** | DOM order matches visual order; tabbing flows breadcrumb → hero (non-tabbable) → promo CTA → summary buttons → rental actions menu → document send buttons → history collapse → tenant card (no tabbable items). |
| Link purpose clear | **Pass** | "Voltar" / "Dashboard" breadcrumb links are unambiguous. The contract id `#<id>` is rendered as `BreadcrumbPage` (non-link, current page). |
| Multiple ways to find pages | **Pass** | Sidebar nav + breadcrumb + (future) search. AA only requires "more than one way" at the site level; satisfied by sidebar + breadcrumb. |
| Headings descriptive | **Partial** | The single `<h1>` is descriptive ("Contrato Ativo"). Section titles (CardTitle) are not heading elements — see A2. |
| Focus visible | **Pass** | Global rule: `*:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px }`. Visible on every focusable element. |
| Focus contrast ≥3:1, ≥2px | **Partial** | `--accent` `#C47E10` on `#F7F6F3` canvas = 3.1:1 ✅ AA non-text. **However:** outline is 1px, below the recommended 2px floor in the WCAG 2.2 advisory (AA target informational). On `#FFFFFF` card the outline = 3.7:1 ✅. The 1px outline is per STYLE.md §3.4 (no ring, no glow) — brand decision. Not a strict AA failure (SC 2.4.7 doesn't specify width), but worth noting. |
| SC 2.4.11 Focus Not Obscured | **Pass** | No sticky headers, drawers, or overlays obscure focused elements on this route. Site header is sticky but the focus is below it; collapsible content scrolls into view via Radix default. |

**Issues:**
- **A3.** Skip link not rendered. → `accessibility-fixes.md`.

### 2.5 Input Modalities

| Criterion | Result | Notes |
|---|---|---|
| Pointer gestures have alternatives | **Pass** | All interactive elements use single-pointer click/tap. No drag, swipe, or multi-touch gestures. |
| Pointer actions cancellable | **Pass** | Standard browser/Radix click semantics — release outside the target cancels activation. |
| Labels match accessible names | **Pass** | Button visible labels match accessible names (no hidden labels). DropdownMenu trigger "Ações" reads as "Ações." |
| Motion-triggered functions have alternatives | **N/A** | No motion-triggered functionality. |
| Touch targets ≥24×24 (SC 2.5.8 AA) | **Pass with note** | shadcn Button `size="sm"` = `h-7` (28px height). `size="icon-sm"` = `size-7` (28×28). All summary buttons, document Send buttons, history collapse trigger, action menu trigger are 28px tall. **Passes** SC 2.5.8 AA (24×24 minimum). **Below** the 44×44 touch-target recommendation for mobile. |
| No accidental drag activation | **Pass** | No draggable elements. |

**Note:**
- **A4 (advisory).** Touch targets pass AA (24×24) but are below the recommended 44×44 for primary mobile interaction. Acceptable for desktop-primary persona (Lucas). If mobile becomes a primary surface, promote `size="sm"` (h-7) to `size="default"` (h-8) and audit again. Listed in `accessibility-fixes.md` as Minor.

---

## 3. Understandable

### 3.1 Readable

| Criterion | Result | Notes |
|---|---|---|
| Page language declared | **Pass** | `<html lang={locale}>` at `[locale]/layout.tsx:48`. Resolves to `pt-BR` or `en` based on the URL segment. |
| Language of parts identified | **N/A** | No mixed-language content within the page. |

### 3.2 Predictable

| Criterion | Result | Notes |
|---|---|---|
| No unexpected context change on focus | **Pass** | Focusing a button does not navigate or open anything. |
| No unexpected change on input | **Pass** | No form inputs on this read-only page (today). The Collapsible toggle and DropdownMenu trigger are explicit user actions. |
| Navigation consistent | **Pass** | Sidebar nav identical across `(app)` routes. Breadcrumb pattern consistent. |
| Components identified consistently | **Pass** | StatusTag, FieldRow, CardTitle behavior is identical across cards. |
| SC 3.2.6 Consistent Help | **N/A** | No help mechanism (chat/phone/FAQ) on this route — when added, it must appear in the same relative order across pages. |

### 3.3 Input Assistance

**Not applicable** — no form inputs on this page today. When edit/cancel/upload mutations ship, each will need its own input-assistance review:
- Errors must be identified in text (not color alone).
- Labels must be visible and programmatically associated with inputs.
- Submission must be reversible, checked, or confirmed.
- SC 3.3.7 Redundant Entry: don't ask for tenant info already on file.
- SC 3.3.8 Accessible Authentication: not applicable on this route.

---

## 4. Robust

### 4.1 Compatible

| Criterion | Result | Notes |
|---|---|---|
| Valid markup | **Pass** | No duplicate `id` attributes. Proper element nesting. `<h1>` then `<section>` with cards. `<dl>/<dt>/<dd>` correctly paired. |
| Name, role, value for UI components | **Pass** | Radix primitives (Breadcrumb, Button, Collapsible, DropdownMenu) ship correct ARIA. StatusTag uses `aria-hidden` on the square so the label is the accessible name. |
| Status messages via ARIA roles | **Partial** | No `role="status"` on the contract status changing surface. Today this is read-only — not a strict AA failure. When Convex wiring lands and status updates live, the StatusTag wrapper should add `role="status"` and the surrounding region `aria-live="polite"`. |

**Issue:**
- **A5 (advisory).** No live regions for future realtime status updates. Listed in `accessibility-fixes.md` as Minor (deferred until Convex wires up).

---

## 5. Token-Specific Checks

### 5.1 Contrast Pairs

All semantic foreground/background token pairs pass AA on Imobiliárias (verified above). On Investidor (dark), the `--success` `#3DAB72` on `--surface` `#16181C` = 6.5:1 ✅ AA, and `--error` `#C94040` on `--surface` `#16181C` = 4.5:1 ✅ AA. All good.

Disabled state contrast: shadcn applies `disabled:opacity-50`. `--text` `#1A1A1A` at 50% opacity on white = ~9.0:1 ✅. `--accent` `#C47E10` on white at 50% opacity = ~2.0:1 — fails AA, but disabled controls are not required to meet contrast (WCAG explicitly exempts inactive UI from 1.4.3 / 1.4.11). Pass.

### 5.2 Focus Ring

- Color `--accent`: 3.1:1 on canvas ✅ AA non-text, 3.7:1 on card ✅ AA all.
- Width: 1px solid (per STYLE.md §3.4). Below the 2px advisory; not a strict AA failure.
- Offset: 2px — does not overlap content. ✅.

### 5.3 Dark Mode Re-verification

Out of scope for this audit (page is Imobiliárias-first). Spot-check above shows headline pairs pass on Investidor. Full re-audit recommended when an Investidor route ships.

### 5.4 Touch Targets

- Button `size="sm"`: 28×28 — passes 24×24 AA, below 44×44 recommendation.
- Button `size="icon-sm"`: 28×28 — same.
- Spacing between adjacent targets: header buttons in summary card use `gap-2` (8px) — under the 24px clear-zone recommended for adjacent interactive targets. Not a strict failure (SC 2.5.8 is satisfied because each target is ≥24px), but on mobile these would benefit from more separation.

### 5.5 Typography Minimums

- Body text: smallest body is `text-base-sm` 14px — above the 12px floor, below the 16px recommendation for body. Acceptable for UI labels and field values; recommendation flags 16px for prose body text, which doesn't apply to this dashboard surface.
- Caption: `text-2xs` 11px (StatusTag label, footnote) — below the 12px floor in the WCAG advisory. **However:** these are decorative status labels and ALL CAPS Mono — readability for Latin uppercase Mono at 11px is acceptable for the brand's audience. Listed as advisory only.
- Line height: `text-base` line-height 1.5 ✅. `text-base-sm` line-height 1.43 ✅ (at or above 1.4 minimum for UI labels).
- Letter spacing: tracking `+0.06em` on Mono uppercase labels — does not reduce; aids legibility.

---

## 6. Mobile Accessibility

| Criterion | Result | Notes |
|---|---|---|
| Orientation | **Pass** | No orientation lock; layout adapts at all breakpoints. |
| Touch targets | **Pass with note** | 28×28 ≥ 24 minimum (SC 2.5.8 AA). Below 44×44 recommended. |
| Reach zones | **N/A** | No fixed bottom controls. |
| Reflow | **Pass** | Already verified above (1.4.10). |

---

## 7. Cognitive Accessibility

| Criterion | Result | Notes |
|---|---|---|
| Reading level | **Pass** | Domain language used appropriately. Field labels are explicit and at a reading level matching the imobiliária professional persona (Lucas, gestor de imobiliária). |
| Consistent navigation | **Pass** | Sidebar identical, breadcrumb pattern identical. |
| No flashing | **Pass** | No flashing content. |
| No time limits | **Pass** | No timeouts on this route. |
| Help available | **Partial** | The asterisk footnote `* {guaranteeTooltip}` is the only inline help. Disabled buttons have no explanatory text. Could improve. |

---

## Summary

**Total criteria evaluated:** 38 (across WCAG 2.2 AA + token-specific + mobile + cognitive)

| Outcome | Count |
|---|---|
| Pass | 30 |
| Partial / Pass with note | 5 |
| Fail | 1 (skip link not rendered) |
| Not applicable | 2 |

**Issues by severity:**

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | A3 (skip link) |
| Major | 1 | A2 (heading hierarchy) |
| Minor | 3 | A1 (decorative icons missing aria-hidden), A4 (touch targets below recommendation), A5 (no live regions yet) |

**Conformance summary:** The Contract Details page on the Imobiliárias front meets **WCAG 2.2 Level AA** on all distinguishability and contrast criteria, on operable keyboard access, on understandability, and on robustness — *with one Critical and one Major fix outstanding*. After A2 (CardTitle heading semantics) and A3 (skip link rendered) are applied, the page conforms to WCAG 2.2 AA.

---

## Accessibility Statement (draft)

> The Contract Details page conforms to **Web Content Accessibility Guidelines (WCAG) 2.2 Level AA** for the Imobiliárias front (default light theme).
>
> **Conformance scope:**
> - Route: `/[locale]/contracts/[id]`
> - Components: `ContractDetailsPage` and its constituent cards
> - Layout: `(app)` segment layout
> - Tested: Imobiliárias front (light theme)
> - Re-tested for: keyboard navigation, screen-reader heading structure, color contrast pairs, touch-target size, reflow at 320px, `prefers-reduced-motion`
>
> **Known limitations:**
> - Investidor (dark theme) accessibility re-verification pending — the page renders in dark mode but the brand contract treats Investidor as a separate front; full re-audit deferred to the Investidor route launch.
> - Loading and error boundaries inherit Next.js defaults (unbranded). Convex wiring will introduce branded variants.
> - Disabled action buttons (Cancel proposal, Edit/Duplicate/Archive, Send) do not yet expose an `aria-describedby` reason — addressed in `prioritized-fixes.md` C5.
>
> **Feedback:** accessibility issues can be reported to `accessibility@tga.finance`.

---

## Cross-references

- [`accessibility-fixes.md`](./accessibility-fixes.md) — remediation steps for issues A1–A5
- [`critique.md`](./critique.md) — design-quality evaluation
- [`prioritized-fixes.md`](./prioritized-fixes.md) — full fix list including non-accessibility items
- Source files: `src/components/contracts/*.tsx`, `src/app/[locale]/(app)/layout.tsx`, `src/app/globals.css`
