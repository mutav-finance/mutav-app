# Pending Treasury Policy Decisions

> Three policy decisions are pinned for **Draau** (treasury policy owner). Each is supported by the architecture as-is — these are operational policy calls, not engineering choices. Once decided, the values land in the **compliance runbook** (not in code, not in this doc); this pack exists so the questions can be walked through in one sitting and the answers captured back into the architecture.

The decisions are interrelated — choosing one constrains the others. Read all three before answering any. The recommended reading time is ~15 minutes; the decision capture template at the end is short.

---

## Decision 1 — NAV update policy

**Question.** How often is NAV updated, and what bounds protect against bad inputs?

**Why it matters.** NAV is computed from two inputs (rental-guarantee fee income + TESOURO yield) — both exogenous and well-defined, so [Mango/Curve-class oracle manipulation is architecturally inapplicable](reliability.md#why-a-dex-style-oracle-is-the-wrong-primitive). The remaining risk is **operator error or compromised treasury role**: a wrong NAV produces wrong mint and wrong redeem amounts; an unchecked update could move user holdings materially. Bounds and pause-on-deviation are the safeguards.

**Four sub-decisions:**

### 1a. Epoch length

How often does NAV update?

| Option                                                            | Trade-off                                                                                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Daily** (cron-driven, treasury team approves once per day)      | Predictable, low-friction, matches traditional fund cadence. Investors see daily NAV movements. Recommended starting point. |
| **Per-event** (each material fee/yield event triggers a proposal) | Most precise; high operational overhead; harder to bound deviation per epoch since epochs vary in size.                     |
| **On-demand** (treasury triggers manually when needed)            | Maximum control; introduces operational variability; investors can't predict cadence.                                       |

### 1b. Per-epoch change cap (%)

Maximum NAV move per update, as a percentage of current NAV. Larger proposed moves require explicit override + additional signers.

| Bound     | When it bites                                                                         |
| --------- | ------------------------------------------------------------------------------------- |
| **±0.5%** | Tight — catches input errors. Refused on a real large-yield-tick day.                 |
| **±1.0%** | Reasonable middle. Covers a normal day; flags anomalies.                              |
| **±2.0%** | Permissive. Allows large moves through; harder for safeguard to catch operator error. |
| **±5%+**  | Effectively no bound. Don't.                                                          |

The right number depends on observed daily NAV variance in the fund's first months of operation. Start conservative; widen if false positives interfere with normal ops.

### 1c. Pause-on-deviation tolerance (%)

If the indexer observes an onchain NAV that differs from the most-recent Convex-recorded proposal by more than this tolerance, mint and redeem **pause automatically**. Humans investigate.

| Bound     | When it bites                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------- |
| **±0.1%** | Catches material drift quickly. Risk of false-positive pauses on normal precision differences. |
| **±0.5%** | Tolerant of normal precision drift; catches meaningful divergence.                             |
| **±1.0%** | Loose; might miss real problems.                                                               |

This is the **circuit breaker**, not the limit on legitimate changes. False pauses are recoverable (humans investigate, lift pause via multisig); missed real drift can mean real loss. Err tighter.

### 1d. Off-NAV operations policy during paused state

When the fund is paused (regulatory pause or NAV deviation), what happens to in-flight operations?

| Option                                       | Implication                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Refund queued mints; hold queued redeems** | Mints reverse cleanly (USDC stays with investor); redeems wait until unpause. Lowest customer friction; longest queue. |
| **Hold all in-flight (mints and redeems)**   | Everything queues; nothing reverses; mass resume on unpause. Simple; longest customer wait.                            |
| **Cancel all in-flight + notify**            | Cleanest state; highest customer friction (re-submit after unpause).                                                   |

Recommendation: **refund mints, hold redeems** — protects customer capital, doesn't compound the pause with redemption pressure.

**Architecture commitment:** any combination of (epoch length × change cap × deviation tolerance × paused-state policy) is supported. Numbers go into the runbook; the wrapper enforces them; the audit log records every proposal with inputs.

**Surfaces in:** [`admin.md` § A6](admin.md#a6--nav-updates-sketch), [`reliability.md` § NAV safety](reliability.md#nav-safety).

---

## Decision 2 — Investor deposit pricing approach

**Question.** Investor deposits arrive in USDC/USDT (per the whitepaper); Mutav SA's treasury is **TESOURO** (BRL-denominated, yield-bearing). How is the conversion priced, and what currency does the investor's NAV print in?

**Why it matters.** This is the **central UX-and-FX decision** for the investor side. It determines whether a Brazilian retail investor sees their position in BRL (intuitive) or USD (FX-volatile); whether a global investor sees a stable USD value (intuitive for them, hides BRL FX) or a BRL value (FX-volatile for them); and whether Mutav takes on any FX hedging operational burden.

**Three options:**

### 2a. Single BRL-denominated NAV

USDC/USDT arrives → Mutav converts to BRL/TESOURO at spot rate on deposit → MUTAV holding tracks BRL-denominated NAV.

- ✓ Simplest architecture
- ✓ Matches Brazilian retail mental model (everything in BRL)
- ✓ No FX hedging burden for Mutav
- ✗ USD-native investor takes BRL FX risk vs USD without an obvious way to hedge it
- ✗ Global investor sees NAV swing on USD/BRL daily moves even when nothing changed in the underlying

**Best fit:** retail BR investors; protocol launch v1.

### 2b. Dual share class (BRL + USD)

Two MUTAV share classes. BR-native investors hold the BRL class; global investors hold the USD class. Mutav hedges the USD class's FX exposure (FX forwards or USDC swap rolling).

- ✓ Both audiences see a stable NAV in their preferred currency
- ✓ Investor-side UX is clean
- ✗ Operational complexity: FX hedging counterparty needed (likely an OTC desk)
- ✗ Hedging cost reduces USD-class yield by hedge basis points
- ✗ Two share classes = two NAV computations, two redemption queues, two reporting surfaces

**Best fit:** when a named global/institutional investor commits and the hedge cost is worth their AUM.

### 2c. USD-denominated NAV with TESOURO underlying

NAV computed daily by FX-converting TESOURO yields to USD; investor sees USD-stable NAV; FX volatility shows up as NAV variance (small day-to-day, larger on shock events).

- ✓ Single share class; investor sees USD throughout
- ✓ No explicit hedging
- ✗ Introduces a daily FX oracle into the NAV computation — **a small oracle risk re-enters the architecture** (which TESOURO had removed)
- ✗ BR retail sees NAV that doesn't intuitively track BRL movements
- ✗ FX shock visibly impacts NAV even when nothing operational changed

**Best fit:** if global is the primary audience and operational FX hedging (2b) is rejected as overhead.

**Recommendation:** **start with 2a (single BRL NAV)** for v1. BR retail is the initial audience; the whitepaper implies BR-domestic launch; the operational simplicity is meaningful at launch. Add the USD class (2b) when a named global LP commits — it's an additive change, not a re-architecture.

**Architecture commitment:** all three are supported. The wallet kit doesn't care; the indexer doesn't care; the compliance domain doesn't care. The choice surfaces in: how the deposit workflow computes the mint amount, how the UI labels NAV/portfolio values, and which CVM reporting template applies.

**Surfaces in:** [`admin.md` § A6](admin.md#a6--nav-updates-sketch), [`investor.md` § Deposit (mint)](investor.md#deposit-mint).

---

## Decision 3 — Pix quarantine window length

**Question.** When agency BRL Pix lands, how long does the corresponding mint sit in quarantine before treasury credit fires?

**Why it matters.** Pix MED 2.0 (mandatory Feb 2026, penalties from May 2026) allows up to **80 days** of fraud-driven reversal with multi-hop tracking. R$6.5B was reversed in 2025 across the Brazilian Pix system. Mutav's quarantine window is the trade-off between treasury chargeback exposure and customer-experience latency. The pre-funded TESOURO float ([reliability.md § Pre-funded float](reliability.md#pre-funded-float--sizing-rules-of-thumb)) absorbs the customer-facing latency — but only if the float is sized adequately for the chosen quarantine.

**Options:**

| Window                            | Customer impact          | Treasury exposure                                                 | Float sizing implication                                                  |
| --------------------------------- | ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Full 80 days** (max MED window) | Zero (float absorbs all) | Zero direct chargeback risk after window                          | Float must cover 80 days of expected agency-settlement volume             |
| **30 days**                       | Zero (float absorbs)     | Modest — covers most MED claims (statistical tail in late window) | Float covers 30 days of volume; treasury accepts ~10–20% of MED tail risk |
| **7 days**                        | Zero (float absorbs)     | Significant — most MED claims still possible                      | Float covers 7 days of volume; treasury accepts ~70%+ of MED risk         |
| **0 days (no quarantine)**        | Zero                     | Full                                                              | No quarantine float; full MED tail risk                                   |

The **right answer depends on**:

1. **Float capital available.** Holding 80 days of TESOURO float means committing significant treasury capital to a non-yield-on-AUM purpose (TESOURO does yield, but the float is opportunity-cost capital that can't be used elsewhere).
2. **Observed MED reversal rate at Mutav's scale.** Industry-wide it was R$6.5B / total Pix volume in 2025; Mutav's specific exposure depends on agency profile, settlement amounts, and B2B vs B2C mix. Brazilian B2B-recurring tends to lower fraud rates than B2C-spot.
3. **Treasury appetite for chargeback risk.** Risk-tolerant treasuries can run shorter quarantine with larger reserve ratios (`reserve = reversal rate × 3` per the reliability doc).

**Recommendation:** **start at 30 days** with the reserve ratio set against observed reversal rate (initial estimate: 0.3–0.5% for B2B-recurring Pix, monitor and adjust). Window can be shortened as Mutav builds operational history and MED reversal patterns at Mutav scale become observable. Longer initial window is reversible; shorter initial window with under-sized float is not.

**Architecture commitment:** any window length is supported. The quarantine primitive is in `reliability.md`; the workflow respects whatever value is set in the runbook; the reconciliation primitive accounts for `pending_quarantine` separately from `settled`.

**Surfaces in:** [`reliability.md` § Quarantine windows](reliability.md#quarantine-windows-reversible-offchain-credit-events), [`admin.md` § A4](admin.md#a4--fund-payments-management), [`onchain-integration.md` § Agency settlement](onchain-integration.md#agency-settlement).

---

## How these decisions interact

| If you choose…                    | …it constrains…                                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Daily NAV epoch (1a)              | Float in 3 sized against daily expected volume × quarantine days                                                                    |
| Tight change cap (1b)             | Faster pause-on-deviation responses; tighter operational discipline                                                                 |
| Single BRL NAV (2a)               | NAV computation has zero FX dependency; supports an even tighter deviation tolerance (1c)                                           |
| Dual share class (2b)             | NAV computation runs twice (one per class); reporting/audit surfaces double; FX hedging counterparty must be selected operationally |
| 80-day quarantine (3)             | Float sizing dominates treasury capital allocation; agency settlement volume is gated by float capacity, not by Etherfuse capacity  |
| Short quarantine + thin float (3) | Treasury bears more chargeback risk; needs explicit risk reserve sized by observed reversal rate × 3                                |

The combination Mutav launches with is **revisable**. Tighter starting bounds (shorter quarantine, lower change cap) are reversible; the inverse may not be without customer notice.

## Decision capture template

Once Draau decides, capture the answers in `convex/compliance/runbook.md` (or equivalent operations doc) with the following template. The architecture docs do **not** hold the values; they reference the runbook.

```markdown
## Treasury policy values (as of YYYY-MM-DD, owner: Draau)

### NAV (Decision 1)

- Epoch length: [daily / per-event / on-demand]
- Per-epoch change cap: ±X%
- Pause-on-deviation tolerance: ±X%
- Off-NAV operations policy during paused state: [refund mints + hold redeems / hold all / cancel all + notify]
- Reviewed: YYYY-MM-DD; next review: YYYY-MM-DD

### Deposit pricing (Decision 2)

- Approach: [single BRL NAV / dual share class / USD NAV with TESOURO underlying]
- Reviewed: YYYY-MM-DD; next review: YYYY-MM-DD

### Quarantine (Decision 3)

- Window length: N days
- Reserve ratio: X× observed MED rate
- Initial float size: R$ X
- Reviewed: YYYY-MM-DD; next review: YYYY-MM-DD
```

Once the runbook entry exists, the three pins in [`admin.md`](admin.md) and [`reliability.md`](reliability.md) become "resolved — see runbook entry YYYY-MM-DD" references rather than open questions. The architecture doesn't change; only the operational defaults do.

## Out of scope for this pack

- **Vendor selections** — KYC vendor (Sumsub), settlement provider (Etherfuse primary, BaaS hedge candidates) are documented in [`regulatory.md`](regulatory.md). Those are commercial decisions, not treasury policy.
- **Multisig signer set** — who specifically holds signing keys. Governance/legal decision, see [`regulatory.md` § Multisig governance](regulatory.md#multisig-governance).
- **Regulatory cliff dates** — Oct 30 2026, May 2026 IP authorization window. Calendar items, not policy decisions.
- **Auth0 application split** — addressed at Auth0 wiring time per [`../auth.md`](../auth.md).
