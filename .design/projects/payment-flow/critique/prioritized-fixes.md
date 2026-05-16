# Prioritized Fixes

> Chunk: prioritized-fixes | Phase: critique | Project: payment-flow | Generated: 2026-05-13

Untagged items are screen-level fixes addressable in build phase. Items tagged `[STYLE]` are brand-level — they belong in `/gsp-brand-refine`. Items tagged `[A11Y]` cross-reference `accessibility-fixes.md`.

## Critical (Must Fix before build)

### 1. Screen 02 mobile density — first-fold hero block

→ `../design/screen-02-address-mode.md`

At 360px viewport, the Mode A card stacks: card label → QR (240×240) → asset amount + copy → separator → address label + 4-line M-address → "Copiar endereço" secondary button → "Abrir em carteira" primary CTA → live-poller row. That's eight elements above the help disclosure. Camila's mental model is "I just want to scan a QR or copy an address" — six blocks of friction before the page settles.

**Fix:**
- **Merge the secondary "Copiar endereço" button into the address block itself.** The 4-line `CopyableAddress` becomes the tap target (whole-block hit area ≥48px); the standalone outline button is removed. Visual savings: one full 48px row + 16px gap = ~64px of vertical real estate.
- **Move the "Como pagar via Stellar" Collapsible above the address block, not below.** First-time tenants need the affordance discoverable before they parse the technical M-address. Keep default-closed.
- Keep the primary "Abrir em carteira" CTA below the address — it's the SEP-7 deep-link, the highest-convenience tier.

This is Critical because it affects the v1 primary path on the v1 primary device (mobile, ≥99% of tenant traffic).

### 2. Screen 06 error.tsx Mono evidence color [A11Y]

→ `../design/screen-06-error.md` §"Color contrast"

The "Código: PAY_LOAD_FAILED · Ref: 9c7e1d-2026-05-13" line uses `--color-text-3` (`#9E9C98` on `#FFFFFF`) which is 2.6:1 — below WCAG AA. The design author flagged this and offered `--color-text-2` (4.5:1) as the escalation.

**Fix:** Take the offered escalation. Update the design chunk to specify `--color-text-2` and confirm in build that `error.tsx` renders the Mono evidence at `#6B6860`.

See `accessibility-fixes.md` row #2 for the formal violation entry.

## Important (High Priority)

### 1. Screen 02 — SEP-7 deep-link silent fallback

→ `../design/screen-02-address-mode.md` §"Interactions" row #2

When a tenant taps "Abrir em carteira" and no Stellar wallet is registered as a `web+stellar:` protocol handler (the common case for Camila), nothing happens silently. The user is left without feedback and without a clear next step.

**Fix:**
- After 800ms of no navigation, show an inline `role="status"` line below the CTA: `Nenhuma carteira detectada. Use o endereço acima para pagar.` (en: `No wallet detected. Use the address above to pay.`)
- Detection mechanism: register a focus-visible listener on the page; if the page remains focused 800ms after `<a>` click, assume the deep-link failed silently. (Browsers blur the page when a protocol handler succeeds.)
- Add this microcopy string to `paymentFlow.address.walletNotDetected` in both pt-BR and en.

### 2. Screen 02 / 03 — XLM amount precision

→ `../design/screen-02-address-mode.md`, `../design/screen-03-wallet-mode.md`, `target-adaptations.md` §AssetAmount

`AssetAmount` displays XLM at 4-decimal precision (`124,7805 XLM`) but Stellar supports 7 (stroops). A tenant who reads the amount and types it manually into a wallet's "send" field will under-fill the payment. The copy button writes the full unbroken precise value, mitigating most cases, but Daniel-type users who like to verify the typed value vs. the displayed value will see a mismatch.

**Fix:**
- Display 7-decimal precision (`124,7805000 XLM`) — JetBrains Mono tabular-nums handles the column width.
- Alternative if visual weight is too heavy: display 4-decimal with a tooltip / inline note "(7 casas decimais ao copiar)" — but the explicit precision is the tighter solution.

### 3. Screen 03 — `freighter-missing` error variant default

→ `../design/screen-03-wallet-mode.md` §"Error states"

When Freighter is not installed, the error currently shows "Instale a extensão Freighter" as primary text with "Prefiro copiar o endereço" as secondary link. Camila will never install Freighter — but she might end up on the Mode B route if a v1.1+ agency has both modes enabled and she taps the "Carteira" tab by curiosity. The current hierarchy makes the install path primary.

**Fix:**
- Invert the hierarchy. Primary amber CTA becomes "Copiar endereço (Mode A)" — wraps a `Link` to `/endereco`. Secondary, quieter line below: "Tem uma carteira Stellar? Instale a Freighter ↗"
- This is brand-true (single primary CTA per screen), task-true (fallback to the mode that works), and persona-true (Camila > Daniel in volume).

### 4. Screen 04 — agency-name redundancy in receipt contact block

→ `../design/screen-04-receipt.md` §"Layout"

The contact block reads: "Imobiliária Costa & Filhos / Em caso de dúvida, fale com a Imobiliária Costa & Filhos / → contato@costaefilhos.com.br". Three repetitions of the agency name in ~10 words. Reads stiff.

**Fix:** Tighten to: "Em caso de dúvida, fale com a Imobiliária Costa & Filhos" + below: "→ contato@costaefilhos.com.br" (no leading agency identification — the name is already in the PaymentSummaryHeader at the top of the page).

## Polish (If Time Allows)

### 1. Screen 07 — three-layer evidence-layer thinness [STYLE-adjacent]

→ `../design/screen-07-not-found.md` §"Three-layer hierarchy verification"

The design author flags this themselves: with no payment data, evidence-layer compliance rests on the `NÃO_ENCONTRADO` badge label. Technically passes; visually thin.

**Fix:** Add a small Mono `Ref: {ISO timestamp}` line beneath the body prose (matches the error.tsx pattern). Specifically the URL fragment that was attempted (sanitized — first 8 chars only) + the lookup timestamp. Format: `Ref: pmt_abcd1234 · 2026-05-13T18:22Z`. Gives the badge label some company in the evidence register, also gives the tenant something to screenshot for the imobiliária.

### 2. Screen 02 / 03 — disclosure default state for first-time tenants

→ Heuristic #10 gap

The "Como pagar via Stellar" Collapsible defaults closed on every load. First-time tenants benefit from a glanceable affordance.

**Fix:** Conditional default — read a `localStorage` flag `tga.tenantSeenPayment` on mount; if absent, default the disclosure open and set the flag on first close. Returning tenants see the closed state. Tiny client-side state, no Convex involvement.

### 3. Screen 04 — "Imprimir recibo" affordance discoverability

→ `../design/screen-04-receipt.md` §"Components used"

The print button sits in the footer, quiet, easy to miss. Power users will find `Cmd+P` natively; Camila won't think to print but might want to "save as PDF" for her landlord WhatsApp group.

**Fix:** Move the print button into the receipt card itself, below the contact block, as a quiet text-link "→ Imprimir recibo" (Inter, `--color-text-2`). Keeps it inside the share-context where tenants are already thinking about evidence preservation. Footer simplifies to just the locale switch.

### 4. Component plan — Card refactor scope

→ `../design/shared/component-plan.md` §"Refactor"

The `Card` refactor row says "Add top-stripe variant — `<Card data-stripe="paid">`" — verify the implementation doesn't break the existing dashboard Card (used in `(app)` routes). The 4px stripe should be additive via a `data-*` attribute, not a CSS-class rewrite.

**Fix:** Add explicit constraint to the build phase: the refactored `Card` must pass `convex-document-types`-style strict review and not change the default rendering of `<Card>` without `data-stripe`.

## Links

- Critique: [critique.md](./critique.md)
- Accessibility fixes: [accessibility-fixes.md](./accessibility-fixes.md)
- Alternative directions: [alternative-directions.md](./alternative-directions.md)
- Strengths: [strengths.md](./strengths.md)
