# ADR 0012 — Phase 1 activation on a multisig reserve: approval + capacity

**Status:** Accepted (2026-11-01) · **Decided by:** Julia (CTO) · **Phase:** First live guarantee ([#427](https://github.com/mutav-finance/mutav-app/issues/427), reader [#428](https://github.com/mutav-finance/mutav-app/issues/428)) · **Amends:** [ADR 0010](0010-activation-is-onchain-registration.md) for phase 1 only · **Related:** [#377](https://github.com/mutav-finance/mutav-app/pull/377) (staff activation), [#376](https://github.com/mutav-finance/mutav-app/pull/376) (underwriting, ADR 0011), [#414](https://github.com/mutav-finance/mutav-app/issues/414), counsel item [mutav#212](https://github.com/mutav-finance/mutav/issues/212)

## Context

The reserve rolls out in three phases:

1. **Simple multisig.** A Squads vault on Solana holding **BRS** (a BRL stablecoin).
2. **Simple vault.** A vault program that holds the reserve but still keeps no registry of guarantees.
3. **MUTAV vault.** The MUTAV reserve program, with `register_guarantee` (mutav-protocol-solana spec §5.2).

ADR 0010 makes a guarantee `active` when its `register_guarantee` is confirmed on-chain. In phase 1 there is no MUTAV program, so nothing on-chain records individual guarantees and that confirmation can never happen. Without a phase-1 rule the first real guarantee cannot start.

What the chain _can_ tell us in phase 1 is the vault's BRS balance. Everything else the reserve program would compute — the book of guarantees, the coverage they require, the free capital left — has to be computed in Convex from the off-chain registry.

## Decision

**In phase 1 a guarantee becomes `active` when compliance approves the signed contract AND the capacity check passes against the Squads vault. The guarantee registry stays off-chain until the MUTAV vault (phase 3). No memo or other on-chain marker is written per guarantee.**

```
drafted
  editing → analysis_requested → accepted (rate fixed)
          → awaiting_signature      preflight vs free capital − active holds; holds cover × c (unchanged from ADR 0010)
          → signed                  signed contract approved by compliance
              ├─ capacity passes ─▶ active            billing starts
              └─ capacity fails ──▶ waiting for reserve capacity   (shown in admin; re-checked, never auto-cancelled)
```

The capacity check, in BRL cents (BRS counted 1:1 with BRL, see Assumptions):

```
balance            = Σ BRS held by the Squads vault        (Solana RPC, finalized commitment)
required coverage  = ⌈ Σ(in-force guarantees' cover) × c ⌉   (pilot c = 0.25)
free capital       = balance − required coverage − active offer holds
passes             ⇔ this guarantee's hold (cover × c) ≤ free capital
```

1. **Approval + capacity, not registration.** The approval of the signed contract is the activating event; the capacity check is its gate. A failed check is a visible state ("waiting for reserve capacity"), not an error and not a cancellation.
2. **The reader fails closed.** Any RPC error, missing token account, wrong mint or unexpected decimals makes the reserve read `RESERVE_READER_UNAVAILABLE`, and no guarantee activates on an unknown balance.
3. **Health is computed in Convex.** Required coverage, coverage ratio (balance ÷ required) and free capital come from the off-chain book, snapshotted every 15 minutes alongside the existing reserve snapshot. Copy says the book is **gated by required coverage**; never "solvency".
4. **The port stays.** The Squads adapter implements the same `ReserveReader` port as the phase-3 program client (`convex/reserve/reader.ts`). Phases 2 and 3 add their own adapters behind it; callers do not change.

### What stays from ADR 0010

- **No agency-clicked activate.** Staff approve; the agency never activates.
- **Offer holds and the preflight** at `accepted → awaiting_signature`, including the granular hold period and the single-operator caveat (in phase 1: a single party approving against the vault).
- **Billing starts at `active`.** No fee for cover that does not exist yet.

### What changes in phase 1

- **No `pending_registration`, no `confirmRegistration({ txSignature })`.** Approval with a passing capacity check goes straight to `active`. `verifyRegistration` stays unimplemented behind the port (the Squads adapter returns `RESERVE_READER_UNAVAILABLE`).
- **No on-chain guarantee id at activation.** The guarantee's `onchainGuaranteeIdHex` is still derivable for phase 3, but nothing cites it in phase 1.
- **Convex is the source of truth for the book.** Unlike ADR 0010's consequence ("Convex stops being the source of truth for capacity"), in phase 1 the chain supplies only the balance; the coverage the book requires is Convex's sum.

## Assumptions

- **1 BRS = R$1.** BRS is a BRL stablecoin; the conversion is the named constant `BRS_CENTS_PER_UNIT` in `convex/reserve/health.ts`. A depeg would overstate the balance — the reader does not price BRS. Revisit if BRS stops trading at par or the reserve holds a second asset.
- **BRS has 6 decimals** (`BRS_DECIMALS`), the same base unit #377's offer holds use. The reader refuses a token account reporting other decimals.
- **`c` is an off-chain constant** in phase 1 (`PILOT_COVERAGE_RATIO_BPS = 2_500` in `convex/reserve/health.ts`), since no program stores it. In phase 3 the program's `c` replaces it.

## Revisit trigger

When the reserve moves to the **simple vault** (phase 2) or the **MUTAV vault** (phase 3), activation returns to on-chain confirmation per ADR 0010, and this ADR is superseded. Also revisit if a second party can move or commit the vault's BRS outside this flow (a second signer set acting independently, a second platform drawing on the same vault): the off-chain book would then no longer see every claim on the balance.

## Counsel note

In phase 1 the **fiança takes effect on compliance approval**, not on registration — there is no registration to cite. ADR 0010 point 6 asked counsel for a clause tied to the on-chain guarantee id; phase 1 needs a clause tied to approval and the reserve's published coverage instead. Tracked as a counsel item in [mutav#212](https://github.com/mutav-finance/mutav/issues/212).

## Consequences

- **#377** drops `pending_registration` and `confirmRegistration` for phase 1. The approval mutation runs the capacity check (via `reserveReader.readCapacity()` and `phase1FreeCapitalBaseUnits` in `convex/reserve/health.ts`) and moves straight to `active`, or into "waiting for reserve capacity". Its offer holds feed the free-capital figure.
- **#428** ships the Squads reader, the health math and the `reserveHealthSnapshots` table; **#429** reads the snapshot on the transparency page.
- **The vault balance is a lagging check.** A withdrawal from the multisig between the read and the approval is not caught until the next read; the multisig signers are MUTAV, and withdrawals below required coverage are an operational rule for them, not an enforced one. Phase 3 enforces it on-chain.
- **Open:** the counsel wording of the phase-1 fiança clause.
