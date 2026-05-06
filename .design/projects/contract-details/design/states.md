# States

## Designed states

### History — empty
`history.length === 0` → `<p>{t("empty")}</p>` in muted body copy. Implemented at `contract-history-card.tsx:46`.

### History — collapsed
`useState(true)` open by default. Trigger uses chevron up/down icons; `aria-label` switches between `t("collapse")` and `t("expand")` on toggle. Solid keyboard support via Radix Collapsible.

### Field — empty value
`FieldRow` renders `—` (em-dash) and applies `text-muted-foreground/60` when `value === ""` or `value == null`. Implemented at `field-row.tsx:15-32`.

### Action menu items — disabled
Three items (`actionEdit`, `actionDuplicate`, `actionArchive`) ship `disabled`, communicating "feature exists conceptually but not in this MVP."

### Buttons — disabled
- Summary card: `Cancel proposal` permanently disabled.
- Documents card: `send` button disabled per slot.
- All inherit shadcn's `disabled:opacity-50 disabled:cursor-not-allowed`.

### Tenant card — conditional footer
`{tenant.termApprovedAt && (<CardFooter>...)}` — the success check + datetime appears only if the tenant has approved the term. Otherwise the card ends after the personal `<dl>`.

### Promo banner — present
Today the banner always renders. There is no dismissal, no per-contract gating. (Possible critique: should it gate on contract.status?)

## Gaps — undesigned states

### Loading
The page is rendered server-side from sync fixtures (`getContractById`). No skeleton, no `loading.tsx` boundary in the route segment. Acceptable today; will be a gap when Convex wiring lands.

### Error
`getContractById` returning undefined triggers Next's `notFound()` (page.tsx:13). No `error.tsx` boundary handles thrown errors during render. Default Next error UI will show — not branded.

### Network slow / mutation pending
Action buttons are disabled, so there's no mutation surface to design pending/success/error states for yet. When edit/cancel ships, each will need its own state design.

### Status transitions
There's no animation or visual cue when contract status flips (e.g. ativo → encerrado). Today this only matters on a refresh — future live updates will need consideration.

### Document upload
The "send" button is disabled. The state design for "uploading", "validation error", "queued for review" is not present.

### Empty contract
A contract with no rental data, no documents at all, no history entries — every section gracefully degrades to `—` field rows or empty-state copy. Verified by reading the components; no fixture covers it.

## Implications

The two real gaps are **loading** and **error** — both deferred until Convex wiring, both worth tracking. The rest are MVP-acceptable.
