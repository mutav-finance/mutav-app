# Project State

## Project: Payment Flow (multi-method)
**Started:** 2026-05-13
**Mode:** greenfield feature on existing codebase
**Brand:** TGA (`.design/branding/tga`)
**Front:** Imobiliárias (light theme)
**Issue:** —

---

## Phase Progress

| # | Phase | Status | Started | Completed |
|---|-------|--------|---------|-----------|
| 1 | Brief | complete | 2026-05-13 | 2026-05-13 |
| 2 | Research | complete | 2026-05-13 | 2026-05-13 |
| 3 | Design | complete | 2026-05-13 | 2026-05-13 |
| 4 | Critique | complete | 2026-05-13 | 2026-05-13 |
| 5 | Build | partial | 2026-05-13 | — |
| 6 | Review | pending | — | — |

## Status Values
<!-- pending | in-progress | complete | needs-revision | skipped -->

## Decisions
- **Scope narrowed 2026-05-13 — Stellar only.** PIX & Boleto deferred. The original 3-method research stays on-file for the v1.1+ resurrection.
- **Recipient: Mutav (the protocol), not the agency.** One treasury `G…` per network via env `STELLAR_MUTAV_SOURCE_ACCOUNT`. Per-payment muxing. Per-agency stable address is a v1.1 agency-settings feature, not part of this flow.
- **Two execution modes:**
  - **A — Payment Address (SEP-23 muxed):** per-payment `M…` address derived from the Mutav treasury G. Any Stellar wallet pays. Reconciler decodes the 64-bit muxed-id from incoming Horizon payments. **v1 primary.**
  - **B — Connect & Pay (Soroban):** Freighter signs `pay_invoice(invoiceId)` on the `mutav-stellar` contract. Scaffolded behind `STELLAR_CONTRACT_MODE` feature flag; wiring **v1.1**.
- **No wallet kit on the client.** `@creit.tech/stellar-wallets-kit` stays uninstalled (prior CVE removal). Mode A is wallet-agnostic. Mode B uses `@stellar/freighter-api` directly inside a dynamic-import island, only when the flag is on.
- Audience: tenant-facing public portal via magic link. Imobiliária-side share/mark-paid actions are v1.1.
- Front: **Imobiliárias** light theme (`:root`). `(public)` layout forces `theme="light"`.
- Visual contract: full TGA Precision Brutalism — 0px radius, three-layer typography, amber under 5%, no shadows, no ring, no rotation.

## Notes
- Existing payments domain is solid: discriminated-union schema for `state` and `method`, list + detail pages, constructors in `convex/payments/domain.ts`. This project is purely additive (1 public query, 1 internal mutation, 1 Node action, 1 cron, 2 small schema fields).
- Public route group `(public)` does not yet exist — introduced in build, sibling to `(app)`.
- Load-bearing research artifact for the design phase: `research/stellar-modes.md`.

## Critique outcome (2026-05-13)
- Nielsen heuristics: **45/50** (Pass)
- Brand contract (STYLE.md): **24/25** (Pass — no constraint violations)
- WCAG 2.2 AA: 38 Pass / 4 Risk / 1 Fail / 7 N/A — Conformant pending fixes
- Verdict: **Pass** — proceed to build
- Review loop count: 1

### Carry-forward to build phase
1. **Critical (apply as inline design refinements before build):**
   - Screen 06 Mono color: `--color-text-3` → `--color-text-2` (a11y contrast fix #2, author-offered)
   - Screen 02 mobile density: merge "Copiar endereço" button into address-block tap target; move help disclosure above address (prioritized fix #1)
2. **Build-phase verification items:**
   - Global 1px transparent border baseline on every focusable element (a11y fix #1)
   - 320px reflow rule for M-address chunking (a11y fix #3)
   - Reduced-motion behavior for pulse dot — resolve contradiction (a11y fix #5)
   - Card refactor scope: ensure `data-stripe` is additive, doesn't break existing `(app)` Card
