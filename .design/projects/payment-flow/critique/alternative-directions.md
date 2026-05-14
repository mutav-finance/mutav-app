# Alternative Directions

> Chunk: alternative-directions | Phase: critique | Project: payment-flow | Generated: 2026-05-13

Two genuinely different redesign approaches. Both fit the brand contract and the brief, but they ask a different question of the user. Documented so the team can evaluate whether the chosen direction is the right one — not as fixes to apply on top of the current design.

---

## Direction A — "Single Action, Progressive Reveal"

**Core question reframed:** What if the page renders one thing only, and the rest is on-demand?

Camila opens the magic link. She sees the agency name, the amount, and a single full-width amber button that says **`Abrir carteira Stellar`**. That's the entire above-the-fold composition. Below it, in `--color-text-2`, a small Inter line: "Ou ver outras formas de pagar ↓"

Tapping the disclosure expands an inline section with the QR + asset amount + 4-line M-address + copy controls. The poller runs ambiently regardless of disclosure state.

### What changes

- **Screen 02 becomes single-action above the fold.** The default convenience tier is the SEP-7 deep-link, on the bet that ≥80% of tenants who land here already have a Stellar wallet (Mode B-curious users) or will install one.
- **The QR and address block become an "advanced/manual" reveal**, hidden by default. Still present, still recoverable, but not the first thing the eye sees.
- **The live poller dot stays at the bottom**, never collapsed — system status is always visible.
- The 4px green stripe pattern carries over to all the "Paid" affordances unchanged.

### Tradeoffs

**+ Pros:**
- Simpler first impression — solves Critical fix #1 by eliminating it.
- Drives users toward the "happiest" path (deep-link → wallet → done).
- The Important fix #1 (silent deep-link failure) becomes the *primary* friction signal that triggers the disclosure auto-open.

**− Cons:**
- Bets that "Abrir carteira" works for most users. If the silent-fallback rate is high (likely on mobile Brazil where wallet penetration is low), the disclosure ends up needing to auto-open anyway — back to current density.
- Daniel and Camila are now both routed through the same path. Daniel benefits less from the wallet-handler shortcut because he already knows how to scan a QR.
- Removing the QR from above-the-fold weakens the "Stellar payment, here's how it looks" recognition cue.

### When to choose this

If user research after v1 launch shows >70% of tenants successfully complete via the SEP-7 deep-link. Then collapsing the manual path is justified. **Recommend v1 ships current design; revisit after telemetry.**

---

## Direction B — "Receipt-First Anchor"

**Core question reframed:** What if the page is always a receipt — pending or paid?

Every screen renders the same `PaymentReceiptCard` shape regardless of state. The card itself is the page. State drives variation:

- **Pending:** card shows agency + amount, but the txHash/ledger rows display as `<Mono>—</Mono>` placeholders inside `<Skeleton>` chrome (no shimmer, brand-true). The amber 4px top stripe is replaced with a 4px `#C47E10` amber top stripe meaning "aguardando". The QR + M-address live inside an Inter prose paragraph mid-card: "Para pagar, escaneie o QR abaixo ou copie o endereço."
- **Paid:** all skeletons resolve into real Mono values. Stripe shifts to `#2E8B5A`. The QR/address block hides via `data-state="paid"`.
- **Expired/Canceled/Error/Not-Found:** same card, evidence rows replaced with the state explanation, stripe color matches the state (red / grey / red / grey).

The flow becomes: one page, four states, no route splitting per execution mode (the QR appears inline within the pending receipt).

### What changes

- **Routing collapses.** No `/endereco`, no `/carteira`, no `/recibo`, no `/encerrado` sub-routes. Just `/pagar/[publicId]` rendering different card states. Magic-link URL is simpler.
- **One page-level component (`PaymentReceiptCard`) carries every state.** Component plan shrinks dramatically.
- **The metaphor inverts.** Instead of "execute → confirm," the tenant sees "the receipt that's about to exist" — the document is real from the first moment, just incomplete. Payment fills it in.
- **Mode toggle in v1.1+** becomes a small inline switch *inside* the card body, not a tab strip above it.

### Tradeoffs

**+ Pros:**
- Conceptually beautiful: the receipt is the page, payment is the act of completing it. Maps to Brazilian tax-document metaphor (nota fiscal that's pending vs. paid).
- Routing simplifies — one route, one error boundary, one not-found, fewer skeletons to design.
- SEO/canonical URL story is cleaner — every payment has exactly one URL across its lifecycle.
- Receipt-first framing makes "share this link to a relative who'll pay" more natural — the relative sees what they're filling in.

**− Cons:**
- The "incomplete receipt" pattern is unfamiliar — most users have a strong mental model that you "go to" a payment screen and "get" a receipt screen. Inverting this requires very careful copy.
- The pending state's QR + address block embedded inside a "receipt" frame is conceptually inconsistent — receipts don't have QR codes; only payment screens do.
- Mode B (Soroban contract sign) is hard to render inside a receipt frame — the "Conectar carteira" CTA doesn't belong on a document.
- Breaks the principle of one URL per discrete tenant intent (recommended by the research's competitor analysis — Stripe, Mercado Pago, Iugu all do separate execution / receipt URLs).

### When to choose this

If TGA's strategic positioning leans heavily on the "everything is a verifiable document" thesis (which is on-brand) and the team is willing to invest in the unfamiliar-metaphor education cost. **Recommend keeping current direction for v1 — but Direction B is the cleaner architecture once tenant fluency is established and Mode B is mature.**

---

## Summary

| Aspect | Current design | Direction A | Direction B |
|---|---|---|---|
| First-fold density (mobile) | High (Critical fix #1) | Low | Medium |
| Routing complexity | High (5 sub-routes) | Same | Low (1 route) |
| Familiarity to BR users | High | High | Low |
| Brand-thesis alignment ("verifiable proof") | Good | Good | Excellent |
| Build complexity | Medium | Medium | Low |
| User research dependency | Low | Medium (needs telemetry) | High (needs concept testing) |

**Recommendation:** Ship current design for v1 with the Critical and Important fixes from `prioritized-fixes.md`. Treat Direction A as a v1.5 simplification once SEP-7 deep-link success rate is measurable. Treat Direction B as a v2+ architectural refactor candidate after Mode B ships and the "receipt as document" thesis can be tested with real tenants.
