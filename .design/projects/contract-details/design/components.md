# Components

## New primitives introduced for this route

### `<Mono>` — `src/components/ui/mono.tsx`
A constrained `<span>` that enforces `font-mono`, `tabular-nums`, and inline `font-feature-settings: "tnum" 1`. Carries `data-mono` for query-ability. This is the implementation of STYLE.md Bold Bet 3 — every numeric value pipes through it. Used 9× across the page.

### `<StatusTag>` — `src/components/contracts/status-tag.tsx`
Implementation of STYLE.md §3.5 Badge spec: a 6×6 colored square + JetBrains Mono uppercase 11px label. Tone-driven via a `Record<Tone, twClass>` map: `accent → bg-accent`, `success → bg-success`, `error → bg-destructive`, `neutral → bg-muted-foreground`. The square is `aria-hidden`; the label carries the meaning. Used in: contract status, document status, tenant approval status.

### `<FieldRow>` and `<FieldGroupHeader>` — `src/components/contracts/field-row.tsx`
- `FieldRow` is a two-column `<dt>/<dd>` row at sm+ breakpoints, stacked at base. Accepts `mono?: boolean` to route the value through `<Mono>`. Empty values render `—`.
- `FieldGroupHeader` is a `<div>` styled as a small-caps mono section label inside the `<dl>` flow.

These are page-local primitives — not promoted to `ui/` because no other route uses them yet.

## shadcn primitives consumed

- `Card`, `CardHeader`, `CardContent`, `CardFooter`, `CardTitle`, `CardAction` — the section container; default `border` and 0px radius globally.
- `Button` — primary (amber fill on Imobiliárias), outline, ghost variants. Sizes `sm` and `icon-sm`.
- `Breadcrumb` family — top nav anchor.
- `Collapsible` — wraps the history card; open by default with chevron toggle.
- `DropdownMenu` — rental-data action menu (3 disabled items).

## Brand-aligned patterns

| Pattern | Where it shows up | STYLE.md ref |
|---------|-------------------|--------------|
| Mono uppercase 11–12px tracking-0.06em label | All `CardTitle`s, `FieldGroupHeader`, breadcrumb, footer "termApproved" | §3.1 label spec |
| 6×6 square + Mono label badge | `StatusTag` | §3.5 Badge |
| 1px solid border surface stacking | All cards (`border-b` headers, `border` on doc tiles) | §6 Bold Bet 5 |
| Three-layer hierarchy on a single screen | Hero (Geist) + body (Inter) + values (Mono) | §6 Bold Bet 4 |

## Brand-misaligned patterns (carried over from shadcn / lucide)

- Lucide icons (`HomeIcon`, `UserIcon`, `CheckIcon`, `FileTextIcon`, `Upload`, chevrons) used everywhere. STYLE.md §4 Always rule mandates Phosphor at `weight="light"`. Currently approximated via `strokeWidth={1.25}`.
- `Card` defaults inherit shadcn shape but rely on the global `* { border-radius: 0 !important }` override in `globals.css:174` to enforce 0px radius. Source classes don't ship with `rounded-none`; they ship with the shadcn default and get neutralized at runtime.
