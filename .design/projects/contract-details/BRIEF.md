# Contract Details — BRIEF

> Project: contract-details · Brand: TGA · Front: Imobiliárias · Created: 2026-05-06
> Mode: retroactive critique (page is implemented; brief reverse-engineered from code)

---

## What this page is

A single-contract detail view inside the Dashboard Imobiliárias front. It is the place an imobiliária goes after clicking a row in the contracts dashboard — the "open contract" state.

Route: `/[locale]/contracts/[id]`
Layout: `(app)` segment — sidebar + site header + content area, max-width 4xl (896px).

## Who it's for

**Lucas** — gestor de imobiliária, 48, light-mode-first, screen-reader-confident, Portuguese (pt-BR primary, en supported via next-intl). Reading on a desktop, occasionally tablet. Needs to confirm contract state, audit history, retrieve documents, and validate the tenant — fast, with high information density but not Investidor-level density (STYLE.md intensity score 4 for this front).

## Why it exists

This is the *evidence* surface for a single guarantee. The Imobiliárias front sells trust through clarity — every numeric value must be tabular and machine-verified, every status communicated through square-and-label (never color alone), every action explicit.

The page must answer four questions without scrolling more than a screen and a half:

1. **What is this contract?** (id, status, next renewal, guarantee available)
2. **What does it cover?** (rent, fees, property, optional metadata)
3. **What documents exist?** (3 fixed slots: rental contract, inspection, policy)
4. **Who is the tenant and is the term approved?**

A fifth — the audit log — sits below as a collapsible.

## Constraints

- **Brand contract:** TGA Precision Brutalism. 0px radius everywhere. Three-layer typographic hierarchy (Geist Bold declaration · Inter explanation · JetBrains Mono evidence) on every screen. Amber under 5% of pixels. Phosphor icons at `weight="light"`. No shadows, no gradients, no glass.
- **Stack:** Next.js 16 App Router, React 19, Tailwind 4 (`@theme` token-driven), shadcn/ui (radix-nova base), next-intl, next-themes, lucide-react (currently — STYLE.md mandates Phosphor).
- **Localization:** pt-BR canonical, en parity. All copy through `useTranslations("contractDetails.*")`.
- **Data:** Static fixtures today (`src/lib/contracts/fixtures.ts` via `getContractById`). Convex wiring deferred.
- **Theme:** Imobiliárias = light (`:root`), Investidor = dark (`.dark`). The Terminal front is not addressed in this view.

## Success criteria

| # | Criterion |
|---|-----------|
| 1 | All numeric values render in JetBrains Mono with `tabular-nums` (Bold Bet 3) |
| 2 | Page presents Geist declaration + Inter explanation + JetBrains evidence (Bold Bet 4) |
| 3 | Status anywhere is a 6×6 colored square + JetBrains Mono uppercase label (STYLE.md §3.5) |
| 4 | No raw Tailwind color scales — every color routes through `--color-*` tokens |
| 5 | No `rounded-*` classes in source (mitigated globally but source must be clean) |
| 6 | No amber on icons; amber reserved for CTAs / status / text / live dot |
| 7 | Page passes WCAG 2.2 AA: contrast, keyboard nav, screen-reader hierarchy, no color-only state |
| 8 | i18n parity en/pt-BR with no literal asterisk ornaments in label strings |
| 9 | Empty / disabled / collapsed states are designed; loading / error states acknowledged |

## Non-goals

- Wiring Convex data
- Editing contracts (all action buttons are `disabled`)
- Document upload behavior (button present, disabled)
- Animation beyond the global pulse
- Investidor or Terminal styling for this route

## Open questions for the critique

- Is the absence of a loading/error state acceptable since data is sync today, or should we design for the Convex future?
- Is the `* {guaranteeTooltip}` footnote line under the hero the right pattern for "this number is qualified" or does it deserve a real `<button>`-driven popover?
- Does the `Cancel proposal` button being `disabled` with no explanatory tooltip violate Nielsen #9 (help users diagnose) ?
- Are three disabled action buttons in the rental-data card's overflow menu a smell that the menu shouldn't be there yet?
