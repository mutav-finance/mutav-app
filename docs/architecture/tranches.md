# Tranches — MTVH / MTVM / MTVL

> `Mutav-Fund` issues three token tranches with a first-loss default waterfall. The tranche an investor holds determines their risk position, yield ceiling, eligibility floor, and redemption priority. This doc is the per-tranche specification; eligibility integrates with the verification-level ladder in [`compliance.md`](compliance.md), and the issuance/holding architecture lives in [`entities.md`](entities.md) and [`onchain-integration.md`](onchain-integration.md).

## Why three tranches

A single-tranche fund pools all default risk across all investors equally. Three tranches let `Mutav-Fund` offer the same underlying (TESOURO-backed BR rental-guarantee credits) to three different risk appetites simultaneously:

- **MTVH** — subordinada. Absorbs every default first. Highest yield ceiling; restricted eligibility. Skin-in-the-game seat for `Mutav-BR`.
- **MTVM** — mezzanine. Absorbs only when MTVH zeroes out. Middle yield, broader eligibility.
- **MTVL** — sênior. Absorbs only when MTVM zeroes out. Lowest yield, broadest eligibility.

The waterfall protects MTVL holders from the first chunk of defaults at the cost of higher per-unit risk to MTVH holders. Investors self-select; pricing reflects the risk.

## Tranche registry

| Tranche  | Position    | Eligibility (proposed; see L4 below)                                                                          | Yield posture | Redemption priority        | Skin-in-the-game holder     |
| -------- | ----------- | ------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------- | --------------------------- |
| **MTVH** | Subordinada | L4+ (qualificado, CVM 175 Art. 4) **or** L5 (institutional, CVM 175 Art. 11) — pending PR mutav#32 resolution | Highest       | Last (after MTVM and MTVL) | `Mutav-BR` mandatory holder |
| **MTVM** | Mezzanine   | L2+ (verified, BCB 519/2025 full KYC) plus offshore Fund subscription                                         | Middle        | Second                     | Open (no required holder)   |
| **MTVL** | Sênior      | L2+ (verified) plus offshore Fund subscription                                                                | Lowest        | First (priority in queue)  | Open (no required holder)   |

**Open: MTVH eligibility floor (L4 vs L5).** PR [mutav#32](https://github.com/mutav-finance/mutav/pull/32) currently says "investidores profissionais"; the colloquial phrase maps to either CVM 175 Art. 4 (qualificado, R$ 1M+) or Art. 11 (profissional, R$ 10M+ / regulated entity). The two carry different marketing rules and subscription thresholds. Pin once Draau resolves. See [`../open-questions.md`](../open-questions.md) — entry in the L-series for this PR.

## Default waterfall

```
Default detected on a contract → Mutav-BR notifies Mutav-Mgmt
                                            │
                                            ▼
                          Mutav-Mgmt instructs Mutav-Fund to liquidate
                                            │
                                            ▼
                          Fund redeems TESOURO at Etherfuse for BRL
                          (or USD-equivalent — see L4c)
                                            │
                                            ▼
                          BRL routed to Mutav-BR for payout
                                            │
                                            ▼
                          NAV waterfall absorbs the loss:

                          ┌──────────────────────────────────┐
                          │ [1] MTVH absorbs first           │
                          │     NAV(MTVH) ← NAV(MTVH) - loss │
                          └────────────┬─────────────────────┘
                                       │ if MTVH → 0
                                       ▼
                          ┌──────────────────────────────────┐
                          │ [2] MTVM absorbs the residual    │
                          │     NAV(MTVM) ← NAV(MTVM) - residual │
                          └────────────┬─────────────────────┘
                                       │ if MTVM → 0
                                       ▼
                          ┌──────────────────────────────────┐
                          │ [3] MTVL absorbs the rest        │
                          │     NAV(MTVL) ← NAV(MTVL) - rest │
                          └──────────────────────────────────┘
```

Invariants:

- A tranche's NAV cannot go negative — any residual after a tranche zeroes out propagates to the next tranche in waterfall order.
- A tranche's NAV update is atomic — the waterfall step is one onchain transaction (or one workflow with the same audit-log correlation id, per [`reliability.md`](reliability.md) § Workflow durability).
- The waterfall is loss-side only — appreciation from TESOURO yield distributes pro-rata across all three tranches at NAV-update time.

## NAV update interaction

NAV updates happen per [`admin.md`](admin.md) § A6 + [`reliability.md`](reliability.md) § NAV safety. Three-tranche additions:

- One NAV update event produces three new NAVs (one per tranche), not one.
- Per-epoch change cap applies per tranche, not globally. MTVH may legitimately move more per epoch than MTVL (it absorbs defaults; it's also the first to benefit from recovery).
- Pause-on-deviation tolerance is per-tranche. MTVH crossing tolerance pauses MTVH-affecting operations (deposits, redemptions) without pausing MTVM/MTVL flows unless the deviation cascades into the waterfall.
- NAV history (audit log) records all three tranche NAVs with one correlation id per update event.

NAV computation lives in `Mutav-Mgmt`'s books (per [`entities.md`](entities.md)); the on-chain projection lives in `convex/fundState` per [`onchain-integration.md`](onchain-integration.md).

## Redemption queue semantics

Each tranche has its own redemption queue. The queues are independent — MTVL liquidity stress doesn't block MTVH redemptions and vice versa. Per-tranche caps and ordering rules:

- **MTVL queue.** First priority on liquidity. Highest expected redemption volume (sênior holders are the most yield-sensitive class). Subject to the fund-level weekly redemption cap from the whitepaper (2.5%) applied per-tranche.
- **MTVM queue.** Second priority. Lower expected volume.
- **MTVH queue.** Last priority. `Mutav-BR`'s mandatory holding cannot be redeemed below the agreed skin-in-the-game minimum (open per PR mutav#32 — TBD percentage of MTVH supply).

Redemption mechanics per tranche match the generic redemption flow in [`investor.md`](investor.md): investor signs burn-and-receive, position enters the onchain queue, NAV applied at execution time (not request time), withdrawal fee applied per the `Mutav-Mgmt` fee schedule.

## Tranche × verification-level capability matrix

This complements [`compliance.md`](compliance.md) § Capability matrix. Read in conjunction.

| Capability                            | L0  | L1  | L2         | L3  | L4                   | L5                   |
| ------------------------------------- | --- | --- | ---------- | --- | -------------------- | -------------------- |
| **Hold MTVL** (sênior)                | —   | —   | ✓ (capped) | ✓   | ✓                    | ✓                    |
| **Hold MTVM** (mezzanine)             | —   | —   | ✓ (capped) | ✓   | ✓                    | ✓                    |
| **Hold MTVH** (subordinada)           | —   | —   | —          | —   | ✓ (if L4 floor)      | ✓ (if L5 floor)      |
| **Redeem MTVL**                       | —   | —   | ✓ (capped) | ✓   | ✓                    | ✓                    |
| **Redeem MTVM**                       | —   | —   | ✓ (capped) | ✓   | ✓                    | ✓                    |
| **Redeem MTVH**                       | —   | —   | —          | —   | ✓ (above SitG floor) | ✓ (above SitG floor) |
| **Transfer between verified wallets** | —   | —   | —          | ✓   | ✓                    | ✓                    |

"L4 floor" = pending PR mutav#32 resolution per the registry note above. Caps are the per-level monthly/lifetime caps from [`compliance.md`](compliance.md) § Transaction limits — applied per tranche, not aggregated across tranches. "SitG floor" = `Mutav-BR`'s skin-in-the-game minimum on MTVH (per the same PR — TBD).

## Onchain representation

- Each tranche is a distinct fungible Soroban asset on Stellar. Three tokens, three issuers (all under `Mutav-Fund`'s Stellar address), three sets of holders.
- Total fund AUM = sum(NAV × outstanding) across the three tranches.
- The `convex/fundState` table carries a `tranche` discriminant per row alongside the existing `chain` discriminant — see [`onchain-integration.md`](onchain-integration.md) § Per-chain indexer modules.

## Related reading

- [`entities.md`](entities.md) — which entity issues / holds / administers what
- [`compliance.md`](compliance.md) — verification levels (L0–L5) and the master capability matrix
- [`investor.md`](investor.md) — investor portal flow, tranche selection at deposit
- [`onchain-integration.md`](onchain-integration.md) — onchain contract topology for the three tranches
- [`reliability.md`](reliability.md) — per-tranche NAV update audit, waterfall workflow
- [`admin.md`](admin.md) § A6 — NAV update operational procedure
- [`../open-questions.md`](../open-questions.md) — MTVH eligibility floor (L4 vs L5), MTVH SitG minimum
