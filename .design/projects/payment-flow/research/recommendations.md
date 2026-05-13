# Recommendations — Adopt / Adapt / Avoid

> Phase: research | Project: payment-flow | Date: 2026-05-13

Synthesized from the six research chunks. Each item cross-references the specific finding that supports it.

## Adopt (direct implementation)

### A1. Card-stack method picker
Three full-bleed cards mobile, 3-column at `md`. Amount-as-hero above the cards. Single primary action: the entire card.
→ See [ux-patterns.md §1](./ux-patterns.md#1-method-selection-layouts) and [competitor-ux.md §3 Nubank](./competitor-ux.md#3-nubank-cobrar-pix-first).

### A2. Server-rendered QR + barcode SVG
Use `qrcode` (node-qrcode) in the PIX RSC and `@bwip-js/node` in the Boleto RSC. Both output SVG strings, no client JS needed for rendering.
→ See [technical-research.md §5 & §6](./technical-research.md#5-qr-code-rendering--server-svg-vs-client-canvas) · [reference-specs.md §6 & §7](./reference-specs.md#6-qrcode-node-qrcode--api-surface).

### A3. Space-grouped linha digitável
Render the 47-digit linha with FEBRABAN-standard space groups in `Mono`/`tabular-nums`. Strip spaces on clipboard copy.
→ See [reference-specs.md §2](./reference-specs.md#2-febraban-linha-digitavel-boleto-bancario) · [competitor-ux.md §4 PagBank](./competitor-ux.md#4-pagbank--pagseguro-link-de-pagamento).

### A4. Chunked Stellar address display
56-char address rendered as 4-char groups `GA3D 4F2X 7Y9Z … MN1P X9KQ`. Clipboard receives unspaced full string.
→ See [competitor-ux.md §6 Coinbase Commerce](./competitor-ux.md#6-coinbase-commerce--crypto-checkout) · [ux-patterns.md §4](./ux-patterns.md#4-qr--barcode-micro-interactions).

### A5. Receipt with brand top-edge stripe
4px `#2E8B5A` top border on the receipt Card — the only decorative success-green in the entire flow. Paired with `PaymentStateTag` (square + label).
→ See [ux-patterns.md §7](./ux-patterns.md#7-receipt-patterns) · [content-strategy.md Receipt screen](./content-strategy.md#receipt-screen).

### A6. Public Convex query with no auth check
Bare `publicId` as the bearer token for v1. UUIDv4 / nanoid(21) gives ≥122 bits entropy. Add `by_publicId` index to the schema.
→ See [technical-research.md §3 & §4](./technical-research.md#3-convex-public-query--no-ctxauth-requirement).

### A7. Clipboard copy with synchronous transient activation
`navigator.clipboard.writeText` called synchronously in onClick — no awaiting fetches before the call. Critical for iOS Safari.
→ See [technical-research.md §7](./technical-research.md#7-clipboard-api--copyablevalue-primitive).

### A8. WCAG 2.2 target sizes
48px buttons (exceeds 2.5.8 minimum). 44×44 hit area on all icon buttons.
→ See [accessibility-patterns.md §4](./accessibility-patterns.md#4-touch-targets-wcag-258).

## Adapt (take the pattern, change for our context)

### B1. Stripe's email handoff → WhatsApp handoff (v2)
Stripe's "send QR to my email" elegantly solves the desktop-laptop / phone gap. For BR, WhatsApp is the native channel. Defer to v2 — out of scope but worth noting in the design.
→ See [competitor-ux.md §2](./competitor-ux.md#2-stripe-checkout--pix-brazil).

### B2. Mercado Pago's "Como pagar" disclosure
Adopt the expandable help — but for SGR's three methods, the Stellar one is the only one with non-trivial steps. PIX and Boleto helpers can be 2 lines max. Don't default to closed — show inline below the primary CTA.
→ See [competitor-ux.md §1](./competitor-ux.md#1-mercado-pago--checkout-pro--bricks-pix-modal) · [content-strategy.md Stellar disclosure](./content-strategy.md#stellar-execution-screen).

### B3. Iugu's persistent receipt URL
Our `/recibo` sub-route already encodes this. Adapt by ensuring even after `state.kind === "paid"`, the URL remains valid and shareable. Add canonical meta tags so screenshots have proper context.
→ See [competitor-ux.md §5](./competitor-ux.md#5-asaas--iugu--payment-links) · [technical-research.md §1](./technical-research.md#1-public-route-group-in-nextjs-16-app-router).

### B4. Live state subscription with auto-redirect
Convex's `usePreloadedQuery` keeps the subscription live after SSR. When state flips `pending → paid` during the session, the client island detects and `router.replace`s to `/recibo`. Adapt: ensure the redirect respects the user's current sub-route so they don't lose context if they're mid-action.
→ See [technical-research.md §8](./technical-research.md#8-state-machine--paymentstate--paymentmethod).

### B5. PIX countdown — visible, not announced
Adopt the 30-min countdown UI (visible expiration time). Adapt by `aria-hidden`-ing the ticking number and exposing a separate `aria-live` region only for milestone alerts (e.g. at 2:00 remaining).
→ See [accessibility-patterns.md §5](./accessibility-patterns.md#5-aria-live-regions).

## Avoid

### C1. No "Já paguei" / "I paid" button
None of the canonical BR checkouts use this. Causes "did I press it?" confusion and lying-user risk. PIX/Boleto: wait for state change. Stellar: replaced by the txHash input (which is verification, not declaration).
→ See [ux-patterns.md §3](./ux-patterns.md#3-i-paid-confirmation-patterns).

### C2. No celebration on receipt
No confetti, no checkmark animation, no "obrigado". Brand voice forbids. The 4px green stripe is the entire celebration.
→ See [content-strategy.md Voice rules](./content-strategy.md#voice-rules-this-surface) · [ux-patterns.md §8 anti-patterns](./ux-patterns.md#8-anti-patterns-to-avoid).

### C3. No "blockchain" / "onchain" / "smart contract" language
Stellar is the brand name we're allowed to use. Everything else: "pagamento direto via rede", "endereço de pagamento", "hash da transação".
→ See [content-strategy.md Forbidden words](./content-strategy.md#forbidden-words-on-this-surface).

### C4. No 2×2 tile grids for method selection
PagBank's pattern feels game-y, doesn't scale, and competes with the amount for visual hierarchy. Card stack wins.
→ See [competitor-ux.md §4 weaknesses](./competitor-ux.md#4-pagbank--pagseguro-link-de-pagamento).

### C5. No dark mode toggle on `(public)` routes
Force `theme="light"` in the public layout. Tenants don't expect or trust a dark payment portal.
→ See [technical-research.md §1](./technical-research.md#1-public-route-group-in-nextjs-16-app-router).

### C6. No `useEffect` polling for state
Convex live subscription handles all state freshness. Don't introduce manual polling — it competes with the subscription and adds bugs.
→ See [technical-research.md §8](./technical-research.md#8-state-machine--paymentstate--paymentmethod).

### C7. No `aria-live` on the ticking countdown
Would announce every second. Use a static "Expira às 18h22" sibling text, and aria-hide the tick.
→ See [accessibility-patterns.md §5](./accessibility-patterns.md#5-aria-live-regions).

### C8. No `outline: none` on focus without replacement
Brand: focus = border color shift to amber. Never naked `outline: 0`. This is the single most-violated brand rule when adapting shadcn defaults — verify in design phase.
→ See [accessibility-patterns.md §10 checklist](./accessibility-patterns.md#quick-apply-checklist).

## Key Decisions (anchor for design phase)

1. **Route shape:** `/[locale]/pagar/[publicId]` with `/pix`, `/boleto`, `/stellar`, `/recibo` sub-routes; `(public)` route group siblings `(app)`. Layout forces light theme, no nav chrome.

2. **Auth model v1:** bare high-entropy `publicId` as bearer. v2 ships signed JWT with 30-day expiry as additive enhancement (no breaking change to URL shape).

3. **Rendering strategy:** RSC for the page shell + payment data (`preloadQuery`); client islands for interactivity (copy buttons, txHash input, countdown). QR + barcode rendered as SVG strings on the server.

4. **State machine:** 12-cell `state × method` matrix collapses to 7 screens. Single `selectScreen()` function drives both server redirect and client live-subscription navigation.

5. **One CTA per screen:** every screen has exactly one primary amber button. Secondary actions are quiet links. Receipt has no primary CTA — it's terminal.

6. **Mono evidence rows everywhere:** all numeric values (amount, due date components, txid, address, hash) use `Mono` + `tabular-nums`. JetBrains Mono Variable.

7. **a11y bar:** WCAG 2.2 AA across the board; targeting AAA on focus-not-obscured (2.4.12) since the public flow is single-purpose. Square+label status badges (never color alone).

8. **Voice:** authoritative calm, specific times and amounts, imperative CTAs. pt-BR canonical, en parity in same commit. No exclamation marks. No emojis. No celebration.

## Sources

All cross-references above. Top-level sources index in [reference-specs.md](./reference-specs.md).
