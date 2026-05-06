# Interactions

## Navigation

- **Breadcrumb** — `Dashboard › #<id>`. The Dashboard segment is a `<Link>` back to `/`. The current segment is rendered as `BreadcrumbPage` (non-interactive), wrapping a `<Mono>#{id}` so the contract id reads as evidence even in nav.
- **Back link** — none beyond the breadcrumb. Browser back is the only escape.
- **Sidebar** — present at all times (App layout segment). Active route is `/contracts`.

## In-card actions

- **Summary card header — three outline buttons:** "Open delinquency", "Track delinquencies", "Cancel proposal". The third is `disabled`.
- **Rental data card header — overflow menu:** trigger is an outline button labeled `t("actions")` with chevron-down. Opens a Radix DropdownMenu with three `disabled` items.
- **History card header — collapse toggle:** `Button variant="ghost" size="icon-sm"`, chevron up/down, switches `aria-label` between `t("collapse")` and `t("expand")` per state.
- **Tenant card — no actions.** Approval status communicated via StatusTag in the header; no manual override exposed.
- **Documents card — per-slot upload:** `disabled` outline button "Send" with upload icon. No drag-and-drop.

## Copy patterns

- **Localized messages** via `useTranslations("contractDetails.*")` — all strings extracted to `messages/{locale}.json`.
- **Hero title** uses an interpolation: `t("heroTitle", { status: tStatus(contract.status) })`. Localized status name stitches into the declaration.
- **Footnote** under the summary hero (`* {t("guaranteeTooltip")}`) is plain text, not a tooltip — the asterisk is decorative ornament, which sits awkwardly with STYLE.md voice ("specific over general"). A real tooltip-on-`?` button would be more honest.
- **Empty marker** is `—` (em-dash, not hyphen, not "N/A") — correct.

## Keyboard interaction

- All Radix primitives (Collapsible, DropdownMenu, Button) ship with full keyboard support out of the box.
- The page does not introduce any custom keyboard handlers.
- Skip link styles defined globally (`globals.css:202`) but **not present in this route's layout** — `(app)/layout.tsx` does not render a `<a className="skip-link">` element. Gap.
- Focus state: `*:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px }` global rule covers everything.

## Hover / motion

- Buttons follow STYLE.md §5: 150ms ease-out color/bg transitions only.
- No `transform`, no `box-shadow`, no `scale()` on hover anywhere.
- No ambient animation on this route (the live-pulse class is reserved for status dots elsewhere).

## Screen reader pathways

- `<dl>` semantics throughout for label-value pairs.
- StatusTag: square is `aria-hidden`, label carries meaning.
- Tenant footer check icon: `aria-hidden`.
- Collapsible trigger: `aria-expanded` and dynamic `aria-label` via Radix.
- Promo banner: an `<h2>` for the title, body in `<p>`. Order makes sense.
- Hero `<h1>` is unique on the page.

Outstanding: the chained outline action buttons in the summary card carry no `aria-describedby` linking to "this requires X to be enabled" — particularly for the disabled `Cancel proposal`.
