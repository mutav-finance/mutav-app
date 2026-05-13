# Brief
> Phase: brief | Project: payment-flow | Generated: 2026-05-13 (updated 2026-05-13)

## Scoping

| Chunk | File | ~Lines |
|-------|------|--------|
| Scope | [scope.md](./scope.md) | ~150 |
| Target Adaptations | [target-adaptations.md](./target-adaptations.md) | ~135 |
| Gap Analysis | [gap-analysis.md](./gap-analysis.md) | ~100 |
| File References | [file-references.md](./file-references.md) | ~100 |

## Decisions captured

- **Method:** Stellar only for v1. PIX / Boleto / card deferred. Multi-method UX research stays on file for the v1.1+ resurrection.
- **Modes (2):**
  - **A — Payment Address (muxed):** per-payment `M…` address derived from `agency.sourceAccount` via SEP-23. Any wallet pays. Reconciler decodes the muxed ID. **v1 primary path.**
  - **B — Connect & Pay (contract):** Freighter (or SEP-7 deep-link) signs a Soroban `pay_invoice(invoiceId)` call on the `mutav-stellar` contract. Scaffolding ships behind `STELLAR_CONTRACT_MODE` flag; live wiring is **v1.1**.
- **Audience:** tenant-facing public portal via magic link. Imobiliária-side share/mark-paid actions are v1.1.
- **Front:** Imobiliárias (light, `:root`). `(public)` layout forces `theme="light"`.
- **Visual contract:** TGA Precision Brutalism — 0px radius, three-layer typography, amber under 5%, no shadows, no ring, no rotation.
- **Recipient:** **Mutav (the protocol), not the agency.** One canonical treasury `G…` per network, env-configured via `STELLAR_MUTAV_SOURCE_ACCOUNT`. Per-payment muxed-id; agency association lives on the payment row only.
- **Backend additions:** 1 public query + 1 internal mutation + 1 global Node action + 1 cron + `payments.muxedId` field (+ `by_muxedId` index) + `stellarIndexState` cursor table.
- **Frontend additions:** 1 public route group + 5 routes + ~13 new components.
- **No wallet kit on client.** Mode A is wallet-agnostic (the M-address + SEP-7 link is enough). Mode B uses `@stellar/freighter-api` directly, gated behind a flag, in an isolated client island. The prior multi-wallet kit stays uninstalled.

## Next phase

`/gsp-project-design` — produce screen-by-screen chunks for the 5 v1 screens (landing, address-mode, wallet-mode scaffold, receipt, expired) anchored on the research findings + the Stellar addendum.

Reference: `../research/INDEX.md`, especially `recommendations.md` and the new `stellar-modes.md` addendum.
