# Competitor UX — Payment Checkouts (BR + crypto)

> Phase: research | Project: payment-flow | Date: 2026-05-13

Six product deep-dives focused on what we can learn for a tenant-facing portal with PIX + Boleto + Stellar.

## 1. Mercado Pago — Checkout Pro & Bricks (PIX modal)

**Flow:** From merchant page → "Pagar" → modal (Nov 2025 default) showing PIX QR + copia-e-cola + 30min countdown. No redirect.

**Method picker:** vertical radio list with logos on the left, label center, "+ informações" affordance on right. Selected radio re-renders the right-hand panel inline (desktop) or pushes a new modal step (mobile).

**PIX execution screen:**
- QR ~200×200, center
- "Código Pix" copy field (full string, monospace, with copy button on right)
- Countdown above QR: "Você tem 29:42 para pagar"
- "Como pagar" expandable accordion below (4 numbered steps)
- "Já paguei" button absent — relies on PSP webhook polling silently

**Strengths:**
- Modal flow keeps merchant context
- Accordion teaches first-time PIX users without cluttering hero
- Strong typographic hierarchy: amount → countdown → QR → copy field

**Weaknesses:**
- 4-step accordion is closed by default — many users miss it
- Logo-heavy radio list looks busy on mobile
- Copy button is icon-only, no label — discoverability dip

**Unique move:** "Salvar QR" download button — lets user finish in another tab/app. We won't copy this (out of scope for v1).

## 2. Stripe Checkout — PIX (Brazil)

**Flow:** Hosted checkout page; PIX appears in payment-method list alongside cards. Selecting it triggers `confirmPixPayment`, which renders an inline panel with QR + copy-paste string + 30-minute expiration ("expires in 29:55").

**Method picker:** radio rows, each with a card-like hit area. Stripe's classic "Link" prefill is detected; PIX sits below card.

**PIX execution panel:**
- Single tall card, white bg
- "Scan with your banking app" instruction
- QR centered, ~256×256
- Copy-paste in a sub-card below with copy icon
- Countdown small, top-right of the panel
- "Send a receipt to my email" optional input — sends QR+key by email so the user can finish on phone

**Strengths:**
- Email-receipt trick solves the "I'm on my laptop, PIX is on my phone" problem elegantly
- Crisp typographic hierarchy, system fonts only — feels native
- Auto-confirms within 5s of bank webhook; UI swaps to success without user action

**Weaknesses:**
- Generic English chrome confuses some BR users
- "Confirmation may take up to 5 minutes" copy creates anxiety — too verbose

**Unique move:** the email-handoff bridge. **For SGR:** consider adding "enviar para meu celular por WhatsApp" CTA in v2 — same problem, BR-native channel.

Source: [Stripe — Accept a one-time Pix payment](https://docs.stripe.com/payments/pix/accept-a-payment)

## 3. Nubank "Cobrar" (PIX-first)

**Flow:** Inside Nubank app → Cobrar → digit amount → "Compartilhar". Generates a share-sheet with QR image + copia-e-cola string.

**Receiver side (when paying a Nubank cobrança via a different bank):** the shared link opens a stripped page with:
- Recipient name + CPF/CNPJ masked
- Amount in huge type (the entire visual anchor)
- "Pagar agora" → opens QR/copia screen
- "Copiar código Pix" as a 56px-tall full-width button (the only primary CTA)

**Strengths:**
- One-CTA discipline — the whole screen has a single primary action
- Amount-as-hero is unforgettable; Nubank teaches the industry standard for "what am I paying?"
- Recipient name visible before amount → "do I trust this?" answered first

**Weaknesses:**
- Almost no metadata (no due date, no purpose) — fine for P2P, not for rent
- Dark purple chrome reads as Nubank-brand, not neutral — we cannot mimic but we can learn the discipline

**Steal:** the amount-as-hero on the method-picker screen. Brand spec already does this (Geist Bold, large), and the Nubank precedent confirms tenants in BR are conditioned to look for the amount first.

Source: [Nubank PIX design — Building Nubank](https://building.nubank.com/storytelling-nubanks-framework/)

## 4. PagBank / PagSeguro Link de Pagamento

**Flow:** Merchant generates link → buyer opens link in browser → method picker (cards / PIX / Boleto) → execution.

**Method picker:** 2×2 grid of method tiles (Cartão, PIX, Boleto, Saldo PagBank). Tiles are 48% width, ~96px tall, icon + label.

**PIX:** classic — QR + copia-e-cola, 30-min countdown.
**Boleto:** barcode SVG full-width + linha digitável in monospace + "Baixar boleto" PDF button + due date in evidence row.

**Strengths:**
- Boleto screen explicitly shows due date in BR format (DD/MM/AAAA) above the linha
- "Pagar com" wording on tiles is imperative — matches our brand voice
- 47-char linha digitável shown with space-separated groups (per FEBRABAN convention)

**Weaknesses:**
- Tile grid feels game-y; doesn't scale beyond 4 methods
- Heavy PagBank chrome (orange + chevron) is brand-cluttered

**Steal:** the linha-digitável-with-group-spaces formatting. We must implement this — raw 47 digits is unreadable.

## 5. Asaas / Iugu — payment links

Both treat payment links as a B2B-grade form: clean white background, method radio at top, execution panel below.

**Asaas distinctive:**
- "Pagamento será confirmado em até 1 dia útil" displayed prominently for boleto — sets expectations
- PIX QR has a small "Atualizar QR" link below — for when expiration is near. Useful but adds state we may not need v1

**Iugu distinctive:**
- "Comprovante" tab appears AFTER payment, persistent — buyer can return to the URL and see receipt later. Critical for boleto where confirmation is asynchronous.

**Steal from Iugu:** the persistent receipt URL — our `/recibo` sub-route already encodes this. Make it permanently accessible (even after `paid` state) so tenants can reopen for proof.

Sources: [PagBank Checkout docs](https://developer.pagbank.com.br/docs/checkout) · [Iugu payment docs](https://www.iugu.com/gateway-de-pagamento)

## 6. Coinbase Commerce — crypto checkout

**Flow:** Merchant share link → buyer chooses chain/asset → screen shows:
- Destination address (chunked, monospace, copy button)
- Amount in crypto units + USD equivalent
- 60-minute countdown
- QR encoding wallet-deeplink URI
- "Save this page until your transaction confirms" inline notice
- After tx, polls chain explorer; status switches to "Detected (1/3 confirmations)" then "Paid"

**Strengths:**
- Chunked address rendering is the gold standard — 4-char groups, monospace
- Live confirmation count is reassuring without being technical
- Single-screen — no method sub-routes, all happens in one place

**Weaknesses:**
- Volatility disclosure copy is long and scares BR users unfamiliar with crypto
- "Insufficient amount" recovery flow is buried

**Steal:** chunked Stellar address rendering. Display the 56-char address as `GA3D 4F2X 7Y9Z … MN1P X9KQ`, copy-on-click copies the unspaced full string.

**Critically different for SGR:** we don't do auto-detection v1. User pastes `txHash` manually. This is a brand voice opportunity: "Cole o hash da transação. Vamos verificar na rede Stellar." (no "blockchain", no "we'll check on-chain" — uses approved language).

Source: [Coinbase Commerce docs](https://commerce.coinbase.com/docs)

## Feature × competitor matrix

| Feature | Mercado Pago | Stripe | Nubank | PagBank | Asaas / Iugu | Coinbase |
|---|---|---|---|---|---|---|
| Method picker style | Radio list | Radio rows | n/a (single) | 2×2 tile grid | Radio top + panel | n/a (single) |
| PIX countdown | 30min visible | 30min visible | n/a | 30min visible | 30min + refresh | 60min (crypto) |
| Linha-digitável formatting | n/a | n/a | n/a | Space-grouped (FEBRABAN) | Space-grouped | n/a |
| Address chunking | n/a | n/a | n/a | n/a | n/a | 4-char groups |
| "Já paguei" button | No | No | No | No | No | No (auto-detect) |
| Manual txHash input | n/a | n/a | n/a | n/a | n/a | No (auto) |
| Receipt URL persistence | Email link | Email link | In-app | Yes | Yes (Iugu best) | Yes |
| Email handoff | No | Yes (great) | n/a | No | No | No |
| Dark mode | Theme-aware | No | App-only | No | No | Yes |

## Synthesis — what SGR should adopt

- **Mercado Pago:** typographic hierarchy on PIX screen (amount → countdown → QR → copy)
- **Stripe:** clean panel composition; (v2) email/WhatsApp handoff
- **Nubank:** amount-as-hero discipline; one primary CTA per screen
- **PagBank:** space-grouped linha digitável; "Pagar com X" imperative wording
- **Iugu:** persistent receipt URL accessible after payment
- **Coinbase:** chunked address rendering; live status with confirmation count (v2)

## What SGR should avoid

- 2×2 tile grids (PagBank) — doesn't scale, looks game-y
- Long disclaimer copy (Coinbase volatility paragraph) — kills trust
- 4-step accordion "como pagar" closed by default (Mercado Pago) — most users miss it
- Tab-style method pickers (Pagar.me v1) — weak affordance on mobile
- Color-only status (any competitor doing red/green only) — fails WCAG 1.4.1

## Sources

- [Mercado Pago — PIX in modal (Nov 2025)](https://www.mercadopago.com.br/developers/en/news/2025/11/14/Pix-payments-now-available-in-modal)
- [Stripe — Pix payments](https://docs.stripe.com/payments/pix)
- [Nubank design system on Figma](https://www.figma.com/customers/nubank-design-system-accessible-experiences-with-figma/)
- [PagBank Checkout docs](https://developer.pagbank.com.br/docs/checkout)
- [Iugu gateway](https://www.iugu.com/gateway-de-pagamento)
- [Coinbase Commerce docs](https://commerce.coinbase.com/docs)
