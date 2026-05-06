# Typography on the Contract Details Route

The page must satisfy STYLE.md Bold Bet 4: every screen has all three typographic registers visible. Below is the per-element mapping.

## Declaration (Geist Bold)

| Element | Class | Where |
|---------|-------|-------|
| Page hero `<h1>` | `font-display text-3xl font-bold tracking-tight text-foreground` | `contract-details-page.tsx:44` |
| Contract ID block | `font-display text-3xl font-bold tracking-tight` | `contract-summary-card.tsx:45` |
| Promo banner title | `font-display text-xl font-bold tracking-tight` | `contract-promo-banner.tsx:11` |

Both hero and contract id render Geist at 28px (`text-3xl`). Two Geist Bold elements on one screen is high — consider whether the contract id should drop one notch (e.g. `text-2xl` 24px) so the hero remains the singular declaration. Bold Bet 4 says "exactly one Geist Bold declaration"; current page has 2–3.

## Explanation (Inter)

The default body family (`--font-sans: "Inter Variable"`) covers everything not explicitly `font-display` or `font-mono`. Used on:
- Field labels (`FieldRow` `dt`)
- Field values that aren't numeric (full name, email, neighborhood, etc.)
- Promo banner body copy
- History entry message text
- Empty state text

Sizes used: `text-base-sm` (14px) for body values, `text-xs` / `text-2xs` (12 / 11px) for labels, `text-base` (16px) for emphasized values.

## Evidence (JetBrains Mono · `tabular-nums`)

Routed through `<Mono>` (or `font-mono` class on small caps labels):

| Element | Source |
|---------|--------|
| Contract id | summary card |
| Next renewal date | summary card |
| Available guarantee BRL | summary card |
| All rental BRL amounts (rent, condo, otherFees, totalRent, fee, oneTimeActivationFee) | rental-data card |
| Setup installments, exitCostMultiplier, rentMultiplier | rental-data card |
| CEP | rental-data card |
| Tenant CPF, birth date, phone | tenant card |
| Term-approved datetime | tenant card footer |
| Each history entry timestamp | history card |
| Breadcrumb contract id `#<id>` | page hero breadcrumb |

Plus `font-mono` directly on small-caps labels: card titles, group headers, breadcrumb, footer "TERMO APROVADO".

## Scale used

Custom TGA scale exposed in `globals.css:65–108`:
- `text-2xs` 11px (labels, footnotes, status tag)
- `text-xs` 12px (card titles, group headers)
- `text-sm` 13px (TGA-specific; not Tailwind's 14)
- `text-base-sm` 14px (body values)
- `text-base` 16px (BRL emphasis)
- `text-xl` 20px (promo title)
- `text-3xl` 28px (TGA-specific; hero + contract id)

No `text-2xl`, `text-4xl+` in use on this route.
