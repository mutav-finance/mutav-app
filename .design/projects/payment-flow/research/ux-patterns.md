# UX Patterns — Multi-Method Payment Portal

> Phase: research | Project: payment-flow | Date: 2026-05-13

## 1. Method-selection layouts

Three canonical patterns compete in 2025 BR checkouts:

| Pattern | Used by | Trade-off |
|---|---|---|
| Radio list (vertical) | Mercado Pago Bricks default, PagBank classic | Compact, scans well on mobile, but feels "form-y" — buries icons & speed hints |
| Cards (stack-then-row) | Stripe Checkout, Asaas, Iugu | Larger tap targets, room for price/speed metadata, mobile-first natural |
| Tabs | Pagar.me v1 (deprecated), Coinbase Commerce | Hides choice cost; tab affordance weak on small screens |

**Recommendation for SGR:** card stack. Three full-bleed method cards on mobile (stacked), three-column row at `md` (≥768px). Justification: with only 3 methods, the choice IS the screen — radio rows steal information density we already paid for in `subtitle` + `amount` above. Cards also let us surface the brand-critical "confirmação imediata" / "1-3 dias úteis" hint per method without nesting.

Card content order (mobile-first):
1. Method label (Geist Bold)
2. Speed hint (Inter, body)
3. Mono evidence row (amount echo or "Pix BCB", "FEBRABAN", "rede Stellar")
4. Affordance arrow or implicit (whole card clickable)

The whole card is the hit target — not a sub-button. Per WCAG 2.5.8, target ≥24×24 CSS px; we go to 48 (vertical) × 100% (horizontal) for fingertip comfort.

## 2. Payment state machines (cross-product)

The discriminated union `payment.state × payment.method` produces 4×3 = 12 logical cells, of which 7 render distinct UI:

| state \ method | null (unchosen) | pix | boleto | stellar |
|---|---|---|---|---|
| pending | Method picker | PIX execution | Boleto execution | Stellar execution |
| paid | (impossible) | Receipt | Receipt | Receipt (txHash row) |
| overdue | Expired screen (no method) | Expired w/ "atualizar" CTA | Expired w/ contato CTA | Expired w/ contato CTA |
| canceled | "Cancelado pela imobiliária" screen (single layout for all methods) |

**Insight:** `paid` collapses into a single Receipt that varies one row of evidence. `canceled` collapses fully. Only `pending` × method needs 3 dedicated routes. This justifies the proposed `/pix`, `/boleto`, `/stellar` sub-routes and a single `/recibo` outcome route.

## 3. "I paid" confirmation patterns

Three industry approaches when a payment requires off-platform action (PIX in another app, Boleto in next-day clearing, manual crypto tx):

1. **Optimistic poll-only** (Stripe PIX): server polls bank; UI shows "aguardando confirmação" until webhook arrives. No user button. Pros: trustworthy; Cons: requires PSP integration we don't have v1.
2. **Manual button + server verification** (Coinbase Commerce, Strike): "Já paguei" / "I paid" button, then server checks on-chain or in DB. Pros: ships without webhooks; Cons: lying-user risk if no verification.
3. **Hybrid attestation** (Asaas crypto, our Stellar method): user pastes `txHash`, server verifies against Horizon/Stellar Expert. Pros: cheap, no PSP needed; Cons: 1 extra input field to design.

**For v1 SGR:**
- PIX: no "já paguei" button. Show countdown, QR, copia-e-cola. Status updates when imobiliária registers receipt manually (v1 fixture) or webhook fires (v2).
- Boleto: same — no button. Linha digitável + "abrir PDF" + clear "1-3 dias úteis" expectation.
- Stellar: paste `txHash` form (the only screen with required user data entry post-method-pick).

## 4. QR & barcode micro-interactions

Baymard's "Receipt / Order Confirmation" study and Mercado Pago Bricks both converge on these patterns:

- **One-tap copy of the primary string** (PIX copia-e-cola, linha digitável, Stellar address). The string is shown truncated with `Mono` font; the icon-button copies the FULL string, not the visible truncated form. Toast confirms.
- **Long-press / right-click should NOT be the primary copy path** — invisible on mobile and discovery-zero.
- **Visual hierarchy on PIX screen:** QR is hero (240×240, white bg, 12px white quiet zone), copia-e-cola is the visible-but-quieter alternative below. Industry default; do not invert.
- **Copy state:** swap icon (clipboard → check) for 1.6s, fire toast "copiado". Do not move the button position — anchor is critical for muscle memory if user re-copies.
- **Stellar address chunking:** GA3D…X9KQ is 56 chars. Display as `GA3D 4F2X 7Y9Z … MN1P X9KQ` in 4-char groups, monospace, with the full string copied opaquely. Per Coinbase Commerce study, chunked addresses reduce miscopy paranoia.

## 5. Empty / loading / error states

Per Convex+Next.js 16 RSC pattern, three states need explicit visual treatment:

- **Initial load (RSC + preloadQuery):** server resolves payment record; if missing → `notFound()`; if found and `state=canceled` → render canceled screen direct (no skeleton flash). Otherwise: hydrate client island with `usePreloadedQuery`.
- **Skeleton on client transitions:** only when user navigates between sub-routes (`/pagar/X` → `/pagar/X/pix`). Use shadcn `Skeleton` for QR placeholder (240×240, no animation if `prefers-reduced-motion`).
- **Error boundary (`error.tsx`):** catches Convex query failures or 4xx from chooseMethod. Single layout: square-amber badge + "não conseguimos carregar este pagamento" + retry button + "fale com sua imobiliária" CTA. Never expose error.code raw — map via next-intl dynamic key.

## 6. Mobile-first sizing & spacing

Realistic floor: 360px viewport (iPhone SE, low-end Android). At 360:

- Page horizontal padding: 16px (`px-4`)
- Card content area: 360 − 32 = 328px
- QR: 240×240 fits with 44px breathing room below (countdown + copia-e-cola)
- Buttons: 48px height minimum (matches our amber-CTA spec) — exceeds WCAG 2.5.8 (24px) and Apple HIG (44pt)
- Tap-target spacing: 8px minimum between adjacent buttons — copy icon must not crowd "abrir PDF"
- Receipt evidence rows: each row a `Mono` line — at 360px, address line truncates with chunked groups remaining readable

`md` breakpoint (≥768) is where the 3-card row activates. We do not need an `lg` variant — receipt and execution screens cap at the `narrow` `PageContent` width (56rem).

## 7. Receipt patterns

Stripe's "payment successful page design" guide and Baymard's receipt benchmark converge on:

1. Status declaration FIRST — "Pagamento confirmado" (Geist Bold, hero) — not "obrigado" / "thanks"
2. Three evidence rows: amount, datetime, identifier (txid / linha-digitável-hash / txHash)
3. Method-specific identifier label: "ID da transação Pix", "Linha digitável paga", "Hash da transação Stellar"
4. Quiet CTA path: "Voltar" + agency contact card (never primary CTA — they're done)
5. No celebration. Per brand voice: "Pagamento confirmado. R$ 2.847,00 às 18h22 — 13/05/2026."

The 4px top-edge `#2E8B5A` stripe on the receipt Card is the ONLY decorative success-green in the flow. It IS the verification — earned, not gratuitous. Pair with the `paid` `PaymentStateTag` for redundant signal (color + label, per WCAG 1.4.1).

## 8. Anti-patterns to avoid

| Don't | Because |
|---|---|
| Confetti, checkmark animation on receipt | Brand: no celebration, no motion theatre |
| "Continuar" as PIX CTA | Brand: imperative + specific — "Copiar código Pix" |
| Show "Aguardando pagamento…" with a spinner indefinitely | Use a countdown with explicit deadline; spinner = unknown duration |
| Color-only state (green/red badge) | WCAG 1.4.1 — square + uppercase label always |
| Auto-redirect to receipt with no user action | Receipt is a destination, not a flash — user needs time to absorb confirmation |
| Dark mode toggle on `(public)` route | Tenants don't expect it; light-mode forced per brief |

## Sources

- [Baymard — Receipt / Order Confirmation Design Examples](https://baymard.com/checkout-usability/benchmark/step-type/receipt)
- [Stripe — Payment successful page design](https://stripe.com/resources/more/payment-successful-pages)
- [WCAG 2.2 — 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)
- [Mercado Pago Bricks — Payment Brick](https://www.mercadopago.com.br/developers/en/docs/checkout-bricks/payment-brick/introduction)
- [Coinbase Commerce docs](https://commerce.coinbase.com/docs)
