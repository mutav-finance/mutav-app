# Contract Details Page — UI Review

**Audited:** 2026-05-06
**Front:** Imobiliárias (light canvas, default theme — `:root` in `globals.css`)
**Baseline:** TGA brand contract (`brand/branding/tga/patterns/STYLE.md`)
**Screenshots:** not captured (no dev server on :3000)
**Method:** code audit against TGA tokens, three-layer hierarchy law, and hard constraints.

---

## Pillar Scores

| Pillar               | Score | Key Finding                                                                                                                                                                                                                                                                                   |
| -------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Copywriting       | 3/4   | i18n keys are descriptive; some labels carry stray asterisks rendered as content (`*${tFields(...)}`) instead of as semantic "required" markers.                                                                                                                                              |
| 2. Visuals           | 1/4   | Decorative amber on the property icon, a circular avatar, and `rounded-2xl` icon containers all violate the 0px-radius and "amber-on-icons-never" constraints.                                                                                                                                |
| 3. Color             | 1/4   | Raw `bg-emerald-600/700/500`, `bg-blue-500`, `bg-amber-500`, `bg-amber-100`, `text-sky-700`, `text-amber-300/600` used everywhere. None of these resolve to `--color-*` tokens. The promo banner is a saturated emerald block — there is no green permitted at this size on Imobiliárias.     |
| 4. Typography        | 1/4   | Three-layer hierarchy is BROKEN: no Geist Bold declaration, no JetBrains Mono evidence layer. Money, dates, contract IDs, CPF, phone, CEP, timestamps are all rendered in the default Inter sans without `font-mono tabular-nums`. This is the single largest contract violation on the page. |
| 5. Spacing           | 3/4   | Uses 8px multiples through Tailwind defaults (`gap-3`, `gap-6`, `py-3`, `px-4`). No arbitrary values. Acceptable.                                                                                                                                                                             |
| 6. Experience Design | 2/4   | Empty/disabled/collapsed states present. Status communicated by color alone in several places (icon-color-only document status). No loading or error coverage.                                                                                                                                |

**Overall: 11/24**

---

## BLOCK-level violations (must fix before ship)

The TGA contract names six absolute "never" rules. This page violates four of them.

| Rule                                                        | Where                                                                                            | Severity                                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No raw Tailwind color scales (must use `--color-*` tokens)  | promo banner, documents card status dots, tenant card badge + check icon, history card title     | BLOCK                                                                                                                                                                                                                           |
| All numbers must be `font-mono tabular-nums`                | contract ID, all BRL amounts, dates, datetimes, multipliers, installment counts, CEP, CPF, phone | BLOCK                                                                                                                                                                                                                           |
| No `rounded-full` / no radius > 0                           | tenant card avatar circle, status dot in summary, status dots in documents                       | BLOCK                                                                                                                                                                                                                           |
| No amber on icons (amber reserved for CTA / status / text)  | property kind icon block uses `text-amber-600` + `bg-amber-100`                                  | BLOCK                                                                                                                                                                                                                           |
| Three-layer hierarchy (Geist + Inter + Mono) on every route | only Inter is present                                                                            | BLOCK                                                                                                                                                                                                                           |
| `rounded-2xl` icon containers, `rounded-lg` doc cards       | rental-data-card, tenant-card, documents-card                                                    | BLOCK (mitigated by global `* { border-radius: 0 !important }` in `globals.css`, but the source classes still must be removed — they signal intent that contradicts the system and will leak the moment that global is touched) |

---

## Top 10 Priority Fixes (apply in order)

1. **Promo banner is a saturated emerald rectangle** — `contract-promo-banner.tsx:8` swap `bg-emerald-600 text-white ring-emerald-700/40 dark:bg-emerald-700` for `bg-[var(--accent-dim)] text-[var(--text)] border-border` (Imobiliárias `--accent-dim` is `#FFF0D4`, the warm amber-tinted surface — that is the brand's "good news" container, not green). Promo CTA at `:14` — drop `border-white/40 bg-white/10 text-white hover:bg-white/20` and use the default `Button` (it already maps to amber via `--color-primary`).

2. **Add the JetBrains Mono evidence layer** (this is the single largest fix). Wrap every numeric value in `<span className="font-mono tabular-nums">`:
   - `contract-summary-card.tsx:46` `{contract.id}` → mono
   - `:61` `formatDateBR(...)` → mono
   - `:68` `formatBRL(contract.availableGuaranteeBRL)` inside the badge → mono
   - `contract-rental-data-card.tsx` every `formatBRL(...)`, `String(rental.setupInstallments)`, `rental.exitCostMultiplier`, `rental.rentMultiplier`, `property.cep` → mono
   - `contract-tenant-card.tsx` `tenant.cpf`, `tenant.birthDate`, `tenant.phone` → mono
   - `contract-history-card.tsx:48` `formatDateTimeBR(entry.at)` → mono
   - `contract-tenant-card.tsx:60` `formatDateTimeBR(tenant.termApprovedAt)` → mono
   - The cleanest path: build a `<Mono>` component (already specified in STYLE.md §7) and pipe everything numeric through it.

3. **Add the Geist Bold declaration layer.** The page has no hero. `contract-details-page.tsx:27` should open with `<h1 className="font-display text-3xl font-bold tracking-tight">` carrying the contract ID or the contract status declaration ("Contrato ativo", etc.). The current `text-2xl font-semibold` at `contract-summary-card.tsx:45` is Inter-default, not Geist Bold — change to `font-display font-bold` and route the contract ID through `<Mono>`.

4. **Remove amber from the property icon.** `contract-rental-data-card.tsx:34` replace `bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300` with `bg-[var(--surface-2)] text-[var(--text-2)]`. Icons must be neutral. Also drop `rounded-2xl` (radius > 0). `size-20` container at `:34` and `size-10` icon at `:35` are fine in size; only the color and radius classes need swapping.

5. **Fix the document status dots.** `contract-documents-card.tsx:18-22` — `bg-amber-500 / bg-blue-500 / bg-emerald-500` are raw scales and the `size-1.5 rounded-full` shape violates the badge spec. Replace the map with token-mapped 6×6 squares per STYLE.md §3.5:

   ```tsx
   const statusDot: Record<DocumentStatus, string> = {
     pendente: "bg-[var(--accent)]", // amber square — pending
     enviado: "bg-[var(--text-2)]", // neutral square — sent
     aprovado: "bg-[var(--success)]", // #2E8B5A — approved
   };
   ```

   Then at `:55` change `size-1.5 rounded-full` to `size-1.5` (zero-radius is enforced globally, but explicit `rounded-none` is clearer) — and bump to `size-[6px]` to match the spec exactly.

6. **Tenant approval badge is a green block.** `contract-tenant-card.tsx:33` `bg-emerald-500 text-white hover:bg-emerald-500` — this is decorative success, exactly what the contract forbids. Replace with the spec'd 6×6 square + JetBrains Mono label pattern:

   ```tsx
   <span className="inline-flex items-center gap-2">
     <span className="size-[6px] bg-[var(--success)]" aria-hidden />
     <span className="text-2xs font-mono tracking-wide text-[var(--text)] uppercase">
       {tApproval(tenant.approvalStatus)}
     </span>
   </span>
   ```

   Also note: `#2E8B5A` on `#F7F6F3` is 3.9:1 — STYLE.md §color-system requires the accompanying label to be Inter Semi-bold ≥14px, which the square+mono-label pattern handles by demoting color to a 6px marker.

7. **Tenant card check-mark uses raw emerald.** `contract-tenant-card.tsx:57` `text-emerald-500` → `text-[var(--success)]`. Also at `:39` and `:26` the avatar circles use `rounded-full` and `rounded-2xl` — drop both, use `size-7` / `size-20` as plain squares with `bg-[var(--surface-2)] text-[var(--text-2)]`.

8. **History card title is sky-blue.** `contract-history-card.tsx:22` `text-sky-700 dark:text-sky-400` is outside the palette entirely. Replace with `text-[var(--text)]` (or `font-display font-bold` if this is the section's declaration anchor). No blue exists in the TGA system.

9. **Status badge in summary uses `rounded-full` dot.** `contract-summary-card.tsx:53` `size-1.5 rounded-full bg-current` — replace with `size-[6px] bg-[var(--accent)]` (or `--success` / `--error` driven by `contract.status`). Also: the `Badge` shadcn primitive defaults to pill shape; either re-style its source to `rounded-none` and remove its `bg-*` fill, or replace these usages entirely with the inline 6×6 + mono label pattern from STYLE.md §3.5.

10. **Field labels carrying literal asterisks as content.** `contract-rental-data-card.tsx:57,61,65,69,73,77,81,85,87,91,93,97,100` and `contract-tenant-card.tsx:45,46,48,51,52` — the `*` prefix is being rendered as part of the label string. If `*` denotes "required field", lift it out: render the label clean (`tFields("rent")`) and append a `<span aria-hidden className="text-[var(--accent)]">*</span>` separately so screen readers can ignore it. As-is, the labels read literally as "\*Aluguel:" which fails copywriting precision.

---

## Per-File Punch List

### `contract-details-page.tsx`

- `:17` `text-sm text-muted-foreground` — fine, but the back-link is the only navigation anchor. Promote to `text-sm font-mono tracking-wide` if you want it to read as a navigation evidence cue, or leave Inter and explicitly add the missing `<h1>` declaration on `:27`.
- `:27` add a Geist Bold `<h1>` carrying the contract ID or status declaration. The page currently has no declaration layer. **BLOCK.**
- `:38` `text-primary hover:underline` — `text-primary` resolves to `--color-accent` (amber) which is allowed for links, but `hover:underline` is fine; `:hover` should also shift to `text-accent-dim` (`#FFF0D4` — would be invisible on canvas — so leave at `text-primary` and let underline carry the hover). OK.

### `contract-promo-banner.tsx`

- `:8` replace `bg-emerald-600 text-white ring-emerald-700/40 dark:bg-emerald-700` → `bg-[var(--accent-dim)] text-[var(--text)] border border-border`. Drop `dark:` variant; tokens already swap. **BLOCK.**
- `:14-16` Button `variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white"` — strip all overrides; use plain `<Button>` so it inherits the amber-fill primary spec from STYLE.md §3.2 Imobiliárias column. **BLOCK.**
- Title `:11` `text-base font-semibold` is Inter Medium-ish — for a promo this should be Geist Bold: `font-display font-bold text-xl`. (Imobiliárias card title spec.)

### `contract-summary-card.tsx`

- `:31` `CardTitle className="text-base"` — promote to `font-display font-bold text-xl`.
- `:45-47` contract ID block — wrap in `<Mono>` and elevate to `font-display`-or-`font-mono` Bold per STYLE.md §3.1 (Imobiliárias card value: JetBrains Mono Medium 16px tabular-nums). Current `text-2xl font-semibold tracking-tight` is sans-serif and not tabular. **BLOCK.**
- `:53` `size-1.5 rounded-full bg-current` → `size-[6px]` square colored by status token (`--accent`/`--success`/`--error`). **BLOCK.**
- `:61` `formatDateBR(...)` wrap in `<span className="font-mono tabular-nums">`. **BLOCK.**
- `:67-68` Badge wrapping the BRL — drop the badge fill (Imobiliárias spec is no fill on badges); render as `<span className="font-mono tabular-nums font-medium">{formatBRL(...)}</span>`. **BLOCK.**
- `:73-75` the bare `*` glyph as a tooltip target is invisible to assistive tech; replace with a `<button type="button" aria-label={t('guaranteeTooltipLabel')}>` carrying the explainer.

### `contract-rental-data-card.tsx`

- `:34` `bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300 rounded-2xl` → `bg-[var(--surface-2)] text-[var(--text-2)]`. Drop `rounded-2xl`. Amber-on-icon is forbidden. **BLOCK.**
- `:35` `HomeIcon className="size-10"` — keep, but switch icon source to Phosphor at `weight="light"` per STYLE.md §7.
- `:50,54,58,62,66,70` (every `formatBRL(...)`) and `:74,78,82,87` (multipliers, installments, schedule) and `:91,93,97,100` (CEP, address number, neighborhood, cityUF) — all numeric. Each must pass through `<Mono>`. The `FieldRow` `value` prop is already `React.ReactNode`, so you can wrap at the call site or, cleaner, change `FieldRow` to accept a `mono?: boolean` and apply `font-mono tabular-nums` on the `dd`. **BLOCK.**
- `:57,61,65,69,73,77,81,85,87,91,93,97,100` — the `*` prefix in the label string is rendered as content. Lift it out (see fix #10). The asterisks also collide with the sentence-case rule in STYLE.md typography (no decorative ornaments).

### `contract-actions-menu.tsx`

- Clean. The dropdown menu primitive should already inherit zero-radius from the global override. Leave.

### `contract-documents-card.tsx`

- `:18-22` raw color scales — see fix #5. **BLOCK.**
- `:46` `rounded-lg border border-border/60` — drop `rounded-lg`. **BLOCK** (signal-level; runtime overridden by global).
- `:50` `FileTextIcon ... text-muted-foreground` — fine.
- `:55` `size-1.5 rounded-full` — replace with a 6×6 square per badge spec. **BLOCK.**

### `contract-history-card.tsx`

- `:22` `text-sky-700 dark:text-sky-400` — out-of-palette blue. Replace with `text-[var(--text)] font-display font-bold`. **BLOCK.**
- `:48` `formatDateTimeBR(entry.at)` — wrap in `<Mono>`. **BLOCK.**
- `:47` `font-medium text-muted-foreground` on the timestamp line is fine semantically, but the timestamp is the evidence layer and must be JetBrains Mono.

### `contract-tenant-card.tsx`

- `:26` `rounded-full bg-muted text-muted-foreground` — drop `rounded-full`. **BLOCK.**
- `:33` `bg-emerald-500 text-white hover:bg-emerald-500` on a `Badge` — full replacement per fix #6. **BLOCK.**
- `:39` `rounded-2xl bg-muted text-muted-foreground` — drop `rounded-2xl`. **BLOCK.**
- `:45-52` `*${tFields(...)}` literal-asterisk labels — see fix #10.
- `:46,48,52` `tenant.cpf`, `tenant.birthDate`, `tenant.phone` — all must be `<Mono>`. **BLOCK.**
- `:57` `text-emerald-500` → `text-[var(--success)]`. **BLOCK.**
- `:60` `formatDateTimeBR(tenant.termApprovedAt)` → wrap in `<Mono>`. **BLOCK.**

### `field-row.tsx`

- `:25` `text-sm text-foreground` — fine for text values, but for numeric values the `<dd>` needs `font-mono tabular-nums`. Add a `mono?: boolean` prop and conditionally apply, or accept the upstream wrap pattern.
- `:30` `"—"` empty marker — good, em-dash is correct. Keep.
- `:37` `bg-muted/40 ... uppercase` group header — semantics fine; the label is the evidence-adjacent layer for grouping. Consider `font-mono text-2xs tracking-wide` to make it consistent with STYLE.md §3.1's Imobiliárias label spec (Inter Medium 14px is also acceptable per the typography table — current `text-xs font-semibold uppercase` is close, just leave).

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

i18n keys are well-organized and Brazilian-Portuguese-aware (`backToDashboard`, `currentStatus`, `availableGuarantee`, `nextRenewal`). Empty state in history card is handled. The single recurring issue is the literal asterisk prefix in `rental-data-card` and `tenant-card` field labels — these read on screen as `"*Aluguel:"` which is brand-imprecise (STYLE.md voice: "specific over general"). Lift the required-marker into a separate aria-hidden glyph.

### Pillar 2: Visuals (1/4)

Three radius violations in source (`rounded-full` on dots and avatars, `rounded-2xl` on icon containers, `rounded-lg` on doc cards). Currently mitigated by `* { border-radius: 0 !important }` in `globals.css:174`, but source class intent is wrong and will leak the moment that global is removed or scoped. Amber on the home icon is the most visible decorative-amber violation on the page. No three-layer hierarchy means there is no visual focal point — the page reads as one undifferentiated tone.

### Pillar 3: Color (1/4)

Raw Tailwind scales counted: `bg-emerald-600`, `bg-emerald-700`, `bg-emerald-500` (×3), `text-emerald-500`, `bg-amber-500`, `bg-amber-100`, `bg-amber-500/15`, `text-amber-600`, `text-amber-300`, `bg-blue-500`, `text-sky-700`, `text-sky-400`. None of these resolve through `--color-*`. Worse, the green block in the promo banner contradicts the brand's narrow success-green policy (`#2E8B5A` is reserved for "pagamento confirmado" markers, not promo backgrounds). Amber on an icon directly contradicts STYLE.md §4 ("Amber-colored icons" listed under Never).

### Pillar 4: Typography (1/4)

The page renders **zero** `font-mono` and **zero** `font-display` classes. Every number — contract ID, every BRL amount across the rental data card (≥10 amounts), CEP, CPF, phone, birth date, multiple datetimes — sits in default Inter without `tabular-nums`. STYLE.md §6 Bold Bet 3 names this as a non-negotiable. STYLE.md §6 Bold Bet 4 names three-layer hierarchy enforcement at the screen level as a checklist item, not a guideline. This page fails both. The fix is mechanical (introduce a `<Mono>` component, route values through it, swap one section title to `font-display`), and once done the page will visibly become a TGA page rather than a generic shadcn dashboard.

### Pillar 5: Spacing (3/4)

Spacing is on the 8px grid throughout — `gap-3` (12px), `gap-4` (16px), `gap-6` (24px), `py-3` (12px), `px-4` (16px), `px-6` (24px), `py-6` (24px), `pt-2` (8px). No arbitrary `[12px]`-style values. Cards stack at `gap-4 md:gap-6` which matches §3.7 (24px gutter). The `max-w-4xl` (896px) for the content column is reasonable for a detail page; STYLE.md spec is 1440px max overall, which is on the parent layout, not this component.

### Pillar 6: Experience Design (2/4)

Disabled states present (`Cancel proposal`, action menu items, document upload buttons). Empty state for history is handled. Collapse/expand state on history card with proper `aria-expanded` and dynamic `aria-label`. **Missing:** loading states, error boundary, and — most importantly — status currently lives only in color. The document status dot communicates state through hue alone (amber vs blue vs emerald), which fails WCAG 1.4.1 (use of color). The fix from #5 (square + mono label) corrects this — the label text carries the meaning redundantly.

---

## Files Audited

- `src/components/contracts/contract-details-page.tsx`
- `src/components/contracts/contract-promo-banner.tsx`
- `src/components/contracts/contract-summary-card.tsx`
- `src/components/contracts/contract-rental-data-card.tsx`
- `src/components/contracts/contract-actions-menu.tsx`
- `src/components/contracts/contract-documents-card.tsx`
- `src/components/contracts/contract-history-card.tsx`
- `src/components/contracts/contract-tenant-card.tsx`
- `src/components/contracts/field-row.tsx`

Cross-referenced against:

- `brand/branding/tga/patterns/STYLE.md`
- `brand/branding/tga/identity/typography.md`
- `brand/branding/tga/identity/color-system.md`
- `mutav-app/src/app/globals.css`
