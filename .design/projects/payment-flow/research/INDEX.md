# Research
> Phase: research | Project: payment-flow | Generated: 2026-05-13

## Research

| Chunk | File | ~Lines |
|-------|------|--------|
| UX Patterns | [ux-patterns.md](./ux-patterns.md) | ~165 |
| Competitor UX | [competitor-ux.md](./competitor-ux.md) | ~160 |
| Technical Research | [technical-research.md](./technical-research.md) | ~225 |
| Accessibility Patterns | [accessibility-patterns.md](./accessibility-patterns.md) | ~175 |
| Content Strategy | [content-strategy.md](./content-strategy.md) | ~170 |
| Reference Specs | [reference-specs.md](./reference-specs.md) | ~220 |
| Recommendations | [recommendations.md](./recommendations.md) | ~155 |
| **Stellar Modes (addendum)** | [stellar-modes.md](./stellar-modes.md) | ~200 |

> 2026-05-13: scope was narrowed to **Stellar only, two modes** (Payment Address via SEP-23 muxed accounts, Connect & Pay via Soroban). The original UX / competitor / a11y / content chunks remain on-file for the deferred PIX & Boleto work but **`stellar-modes.md` is the load-bearing reference for the design phase**.

## Top-level findings

- **Card-stack method picker beats radio rows and tile grids for a 3-method flow.** Whole card is the hit target; amount-as-hero above the cards; speed hint per method ("Confirmação imediata" / "1-3 dias úteis" / "após registro na rede"). Matches Nubank discipline of one primary action per screen and Mercado Pago's typographic hierarchy without their accordion bloat.

- **Server-render the QR and barcode as SVG.** Use `qrcode` (node-qrcode) for the PIX EMV BR Code payload and `@bwip-js/node` for the FEBRABAN interleaved-2-of-5 barcode. Both run cleanly in Next.js 16 RSC, produce smaller payloads than client libraries, and carry `<title>`/`<desc>` for screen-reader semantics.

- **Bare `publicId` is the v1 auth model.** No `ctx.auth` in the Convex query; the high-entropy `publicId` IS the bearer. Add `by_publicId` index. v2 layers a signed token without breaking the URL shape. The threat model is guess-resistance, not interception — entropy defeats guessing.

- **Voice and a11y are tightly coupled brand decisions.** Forbidden words on this surface include `blockchain`, `onchain`, `smart contract`, `token`, and `liquidação`. Status badges = square + uppercase label (WCAG 1.4.1 + brand). Focus = border-color shift to amber `#C47E10`, never `outline:none`, never ring/shadow. Countdown is `aria-hidden`-tick + static "Expira às 18h22" sibling text.

- **The state × method matrix collapses to 7 screens.** A single `selectScreen()` function drives server-side redirect and client-side live-subscription navigation; `paid`/`canceled` outcomes converge to single receipt/canceled layouts regardless of method, with method-specific evidence rows. Convex live subscription auto-redirects `pending → paid` to `/recibo` without page refresh.
