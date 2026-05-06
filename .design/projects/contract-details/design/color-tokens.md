# Color & Tokens

## Token surface used

All color is routed through `--color-*` tokens (defined in `globals.css:9-118`). The Imobiliárias front maps to:

```
canvas      #F7F6F3
surface     #FFFFFF
surface-2   #EEEDEA
surface-3   #FFF8EE
border      #D9D7D2
text        #1A1A1A
text-2      #6B6860
text-3      #9E9C98
accent      #C47E10  (amber, deeper for AA on white)
accent-dim  #FFF0D4  (warm cream — promo banner)
success     #2E8B5A  (only as 6×6 square or ≥14px Inter Semi-bold label)
error       #B83232
```

These are aliased into shadcn's variable surface via `@theme inline` so primitives like `Card`, `Button`, `Badge` keep working with `bg-card`, `text-foreground`, `border`, etc.

## Where each token shows up

| Token | Element |
|-------|---------|
| `--color-canvas` (`bg-background`) | page background, body |
| `--color-surface` (`bg-card`) | every Card |
| `--color-surface-2` (`bg-secondary`, `bg-muted`) | icon-container squares (property, tenant avatar), FieldGroupHeader bar |
| `--color-border` (`border`) | Card borders, doc tiles, every FieldRow `border-b` |
| `--color-text` (`text-foreground`) | all primary text |
| `--color-text-2` (`text-muted-foreground`) | labels, secondary copy, lucide icons inside containers |
| `--color-accent` (`bg-accent`, `bg-primary`) | StatusTag accent square, primary Button fill, breadcrumb hover |
| `--color-accent-dim` (`bg-accent-dim`) | promo banner background |
| `--color-success` (`bg-success`, `text-success`) | StatusTag success square, footer check icon |
| `--color-error` (`bg-destructive`) | StatusTag error square |

No raw Tailwind color scales (`bg-emerald-*`, `bg-amber-*`, `text-sky-*`, etc.) appear in any of the contract components — verified.

## Amber budget on this route

Page is light-mode (Imobiliárias). At 1280×900 viewport on a typical render:

- Sidebar amber: ~0 (the dashboard sidebar uses `--color-sidebar-primary: var(--accent)` only on active nav; on this route the active route is `/contracts`, so 1 small amber dot/border on a sidebar item ≈ 80px²)
- Promo banner cream surface ≠ amber, it's `accent-dim`
- Promo banner CTA fill (amber): ~120×40 = 4,800px²
- StatusTag accent squares: 6×6 = 36px² (×3 if all three documents are pending, but typically 1–2)
- Breadcrumb link `text-primary` color on hover only
- Total amber pixels at most: ~5,000px² ÷ 1,152,000 ≈ 0.4%. Well under the 5% budget.

## Risk: status color contrast

`--success` is `#2E8B5A` on `#FFFFFF` card → 4.0:1 (AA pass for Inter Semi-bold ≥14px, fails for smaller text). The StatusTag uses an 11px Mono Medium label rendered in `text-foreground` (`#1A1A1A`), not in success-color, so the label is fine — the tone color only paints the 6×6 square. This is the correct application of STYLE.md §3.5.

`--error` is `#B83232` on `#FFFFFF` card → 5.4:1 (AA pass for both body and large). Same square-only application.

`--accent` is `#C47E10` on `#FFFFFF` card → 3.7:1 (FAIL for body text, PASS for large text and non-text UI). Only used as a 6×6 square (non-text) — fine. As `bg-primary` on Button, the foreground override `--color-primary-foreground: #1A1A1A` gives 5.3:1 (AA pass).

## Dark mode

The page inherits `.dark` (Investidor token set) via `next-themes`. STYLE.md treats Imobiliárias and Investidor as separate fronts with different intensity profiles, but the implementation conflates "Imobiliárias = light" with "user toggled light" and "Investidor = dark" with "user toggled dark". This is a simplification that works visually but loses the per-front density / typography differentiation. Worth flagging in critique.
