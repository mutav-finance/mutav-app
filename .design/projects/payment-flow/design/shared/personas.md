# Personas

> Chunk: personas | Phase: design | Project: payment-flow | Generated: 2026-05-13

This surface is tenant-facing first. Lucas (the imobiliária user) is upstream — he shares the magic link from `/payments/[id]` and never enters the public flow himself.

## P1 — Camila, 31, locatária (primary)

| Attribute | Value |
|---|---|
| Role | Tenant paying monthly rent — has been in the same apartment 14 months |
| Device | iPhone 13 mini, Safari, often single-handed, in landscape rarely |
| Context | Receives a WhatsApp from her imobiliária with a link; reads in line at the supermercado; sometimes opens it later on a 15" MacBook |
| Crypto exposure | Heard of Stellar exactly once. Has never opened a wallet. Owns no XLM. |
| Banking | Itaú app on the home screen. PIX is the default verb. Boleto when the source is gov-adjacent. |
| Trust threshold (first 2s) | Sees agency name + amount + due date → trusts. Sees a wall of "blockchain copy" → bounces. |
| Goal | Pay rent. Get a receipt she can screenshot to the landlord WhatsApp group. |
| Frustration | Long forms. Ambiguous status. Modals that lock the page. "Continuar" buttons that don't say what continues. |
| Success state | Pays in one motion: scan or copy, paste in wallet, walk away. Page tells her when it lands. |

**Design implication for Mode A:** Camila will not connect a wallet. She might receive the link, forward it to a relative who has Lobstr, and that relative pays. Mode A — `M…` address + QR + SEP-7 — is the only mode she can complete without learning a new product.

**Anti-pattern:** any state that demands she enter a transaction hash. The Horizon poller is invisible — the page just *updates* when the payment lands.

---

## P2 — Daniel, 38, locatário-tech (secondary)

| Attribute | Value |
|---|---|
| Role | Backend dev, side-renter from an investidor friend's apartment |
| Device | Pixel 7, Chrome, frequently switches to desktop Firefox to "look at the source" |
| Context | Pays from a Lobstr mobile wallet, occasionally from Freighter on desktop. Has used SEP-7 deep-links before. |
| Crypto exposure | High. Reads `stellar.expert` for fun. Knows what a memo is. |
| Banking | PIX-first, but actively wants to use Stellar where the option exists |
| Trust threshold | Looks for the muxed `M…` prefix, the SEP-7 URI in the QR, and a working `stellar.expert` link on the receipt. Will check the destination matches the protocol's published treasury G-account. |
| Goal | Validate the protocol works as advertised; pay the rent. |
| Success state | Scans QR → Lobstr opens with destination + amount filled → confirms → Horizon poller flips the page to receipt within ~30s. |

**Design implication:** Daniel is who the receipt's `stellar.expert` link, ledger number, and `txHash` are for. He is also the user who notices if the QR encodes a `G…` instead of an `M…`. The four-line address chunk + ledger metadata is non-negotiable evidence for him; cosmetic for Camila.

---

## P3 — Lucas, 42, imobiliária owner (upstream — out of public flow)

| Attribute | Value |
|---|---|
| Role | Owner-operator of a small imobiliária in Curitiba (existing `(app)` persona) |
| Device | 14" MacBook Pro, Chrome. Single browser tab for SGR open all day. |
| Context | Generates a payment in `/payments/new`, shares the magic link with the tenant via WhatsApp |
| Crypto exposure | Heard the brand pitch. Doesn't care which method the tenant uses as long as the money lands. |
| Goal | Watch the payment go from `aguardando` to `pago` without phoning the tenant. |
| Trust threshold | Sees the receipt the tenant will see — must look like *his* imobiliária generated it, not a third-party platform. |

**Design implication:** Lucas does not enter the `(public)` flow during normal operation. But he WILL test the link on his phone the first time he uses the feature — the brand chrome (agency name above the fold) is for him as much as for the tenant. The `PaymentSummaryHeader` puts `{agencyName}` as the Inter explanation line directly above the Geist Bold amount.

---

## Context map — who sees what

| Surface | P1 Camila | P2 Daniel | P3 Lucas |
|---|---|---|---|
| Magic-link landing | Always | Always | Once, for QA |
| Address-mode panel (Mode A) | Always | Always | First-run QA |
| Wallet-connect panel (Mode B, v1.1) | Never | Sometimes | Never |
| Receipt | Always | Always | Confirms via the live state change in `(app)`, not by visiting `/recibo` |
| Expired / canceled | Rare | Rare | Sees corresponding state in `(app)` |
| Error | Should be near-impossible | Same | Same |
