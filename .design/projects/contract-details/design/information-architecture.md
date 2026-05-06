# Information Architecture

## Route

`/[locale]/contracts/[id]` inside the `(app)` segment. Wraps the dashboard layout (sidebar + site-header).

## Section order (top → bottom)

1. **Breadcrumb** — `Dashboard › #<contract.id>`. Mono uppercase, 11px, letter-spacing 0.06em.
2. **Hero `<h1>`** — Geist Bold 28px (`text-3xl`). Renders `t("heroTitle", { status })` — e.g. "Contrato ativo". This is the screen's single declaration anchor (Bold Bet 4).
3. **Promo banner** — `bg-accent-dim` (#FFF0D4 — the warm cream surface), Geist Bold 20px title, Inter explanation, amber-fill CTA. Optional, non-blocking, frame-level encouragement.
4. **Summary card** — contract id (Geist Bold 28px + Mono), status (square+label), next renewal (Mono date), available guarantee (Mono BRL). Header: small mono uppercase "RESUMO" + 3 outline action buttons (open delinquency, track delinquencies, cancel proposal — disabled).
5. **Rental data card** — left rail: property kind icon container + lowercase mono kind label. Right rail: a `<dl>` of FieldRows grouped by `Contract`, `Property`, `Optional`, `Documents` (the last group is a placeholder header).
6. **Documents card** — three fixed slots (`rentalContract`, `inspection`, `policy`) as a 3-column grid; each: file icon + label + status tag + disabled "send" button.
7. **History card** — collapsible (open by default). Empty state present. Each entry: mono timestamp + sentence message.
8. **Tenant card** — header with avatar square + heading + status tag (right-aligned). Body: avatar large square + personal `<dl>` (fullName, cpf, birthDate, email, phone). Footer (when `termApprovedAt`): success check icon + mono uppercase "TERMO APROVADO" + mono datetime.

## Hierarchy

| Layer | Element | Where |
|-------|---------|-------|
| Declaration | `<h1>` Geist Bold 28px | Page hero |
| Declaration (sub) | Geist Bold 28px + Mono contract id | Summary card body |
| Section labels | Inter/Mono small-caps 12px tracking-0.06em | Card titles, FieldGroupHeader |
| Explanation | Inter Regular/Medium body | Field labels, copy |
| Evidence | JetBrains Mono `tabular-nums` | All numeric values, datetimes, ids, status labels |

## Density

Imobiliárias intensity = density 4 (light, structured, less compressed than Investidor). The 4xl content max-width (896px) and `gap-4 md:gap-6` between cards reflect that. Card internal padding is 24px (`px-6 py-3`–`py-6`).

## Reading order

Status → renewal → guarantee → economics (rent, fees, multipliers) → property location → optional metadata → documents → audit history → tenant. This puts state and money first, audit and people last — appropriate for the imobiliária persona who arrives wanting to confirm, not explore.
