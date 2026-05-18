# Open Questions

> Master index of unresolved questions across legal, treasury policy, vendor, and engineering. Each entry links to the canonical context. **Architecture supports any answer to most items** — this file exists so the questions don't get re-derived every session.

## Conventions

- **Owner** — who needs to answer (Counsel / Draau / Eng / Vendor / TBD)
- **Blocks** — what's gated on the answer; forcing-function date if any
- **Canonical source** — where the deeper context lives
- **Curator** — whoever lands a PR that resolves an item moves it to `Recently resolved` in the same PR. The next person editing this doc deletes anything sitting in `Recently resolved` before adding their own changes.

---

## Legal & regulatory — pending counsel

### L1. Mutav SA's own license stack

**Question.** Must Mutav SA register as a VASP (BCB Res 519/520/521), a payment institution (BCB Res 494–497), a FIDC (Fundo de Investimento em Direitos Creditórios), a FIF (Fundo de Investimento Financeiro), or some combination?

**Why it matters.** Determines which BCB norms apply directly vs to counterparties. BCB Res 521/2025 monthly stablecoin reporting (started **May 4, 2026** — already in effect) binds VASPs directly; if Mutav is a VASP, it ships that reporting now. If Mutav is a consumer-of-VASPs, the providers report and Mutav preserves audit-grade records.

**Owner.** External counsel.
**Blocks.** Audit log primitive cadence, reconciliation reporting surface, whether the daily on-chain reconciliation job (E3 below) is regulatory-mandatory or just architecturally-correct.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) §§ "TESOURO as treasury asset — classification implications" (lines 55–67) and "Out of scope" (line 242).

### L2. CVM 175 fund-of-funds applicability

**Question.** Does Mutav SA's two-layer structure (investors hold MUTAV → MUTAV represents claim on TESOURO → TESOURO represents claim on Tesouro Direto) trigger CVM 175 Anexo II fund-of-funds rules?

**Why it matters.** Disclosure surface changes (investor UI must show TESOURO holding explicitly, not abstract NAV) and CVM filing obligations change with classification.

**Owner.** External counsel.
**Blocks.** Investor-portal disclosure UI, CVM filing template.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) line 64.

### L3. Etherfuse authorization coverage

**Question.** Do Etherfuse's existing CVM/BCB authorizations cover Mutav's specific use case (rental-guarantee treasury + investor on-ramp), or does Mutav SA need its own?

**Why it matters.** If Etherfuse's umbrella covers us, the Oct 30 2026 cliff is downstream-only. If not, Mutav needs its own authorization track started immediately.

**Owner.** External counsel, in dialogue with Etherfuse legal.
**Blocks.** Authorization track scoping; relates to L1.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) line 65.

### L4. Tax treatment of MUTAV holders

**Question.** IRRF and IOF treatment of MUTAV token holders relative to direct Tesouro Direto holders — equivalent, worse, or better?

**Owner.** External counsel + tax advisor.
**Blocks.** Investor-portal tax disclosure, year-end reporting tooling.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) line 66.

---

## Treasury policy — pending Draau

Three policy decisions are packed for a single ~15-minute walkthrough with Draau. Architecture supports any answer; values land in the compliance runbook, not in code.

**Canonical source.** [`architecture/pending-treasury-decisions.md`](architecture/pending-treasury-decisions.md) — full trade-off tables and recommended starting points.

| #      | Decision                 | Sub-decisions                                                                                     | Architecture pins                                                                                     |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **T1** | NAV update policy        | epoch length, per-epoch change cap, pause-on-deviation tolerance, off-NAV operations during pause | [`admin.md`](architecture/admin.md) § A6, [`reliability.md`](architecture/reliability.md) line 234    |
| **T2** | Deposit pricing approach | single BRL NAV / dual share class (USD + BRL) / USD NAV with TESOURO underlying                   | [`investor.md`](architecture/investor.md) line 122, [`admin.md`](architecture/admin.md) § A6          |
| **T3** | Pix quarantine window    | 7 / 30 / 80-day options with stated trade-offs                                                    | [`reliability.md`](architecture/reliability.md) line 72, [`admin.md`](architecture/admin.md) line 184 |

**Owner.** Draau (treasury policy).
**Blocks.** Compliance runbook completion; NAV update job operational defaults; investor-facing quarantine UI copy.

---

## Vendor selection

### V1. KYC provider — Sumsub vs alternative

**Question.** Confirm Sumsub as the KYC provider for BCB Res 519/2025 compliance, or pick an alternative.

**Open sub-questions for Sumsub specifically.** 3 sales questions outstanding per project notes — biometric liveness (ISO/IEC 30107-3 PAD Level 2+), SERPRO/Datavalid integration scope, LGPD DPA with ANPD SCCs.

**Owner.** Eng + business (sales contact required).
**Blocks.** Investor onboarding flow lock-in; can't ship retail v1 without it.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) §§ "KYC vendor selection criteria" (lines 82–88).

### V2. Etherfuse B2B settlement extension

**Question.** Can Etherfuse extend its current investor-on-ramp integration to cover agency-side B2B settlement (rental-guarantee Pix collection → TESOURO mint)? Capacity, pricing, contractual terms.

**Owner.** Business (Etherfuse account manager).
**Blocks.** Single-counterparty rail design (concentration risk known and accepted); fallback rails kick in if this stalls.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) line 139, [`stellar-anchors.md`](stellar-anchors.md).

### V3. BaaS hedge candidate selection

**Question.** Pick **one** of Transfero / Bitso / Foxbit as the BaaS hedge rail (mitigates Etherfuse concentration risk).

**Per-vendor open items:**

- **Transfero BaaSiC** — confirm Stellar-native USDC in one hop (not publicly documented; needs sandbox); pricing gated by sales.
- **Bitso Business** — webhook + correlation-id story; pricing.
- **Foxbit Prime Desk** — quote-driven pricing — volume threshold for sensible negotiation.

**Owner.** Eng + business.
**Blocks.** Failover playbook; not blocking v1 if Etherfuse stays healthy.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) §§ "Treasury rail" table (lines 138–142).

---

## Engineering deferrals

Each of these has a clear forcing function; intentionally not built today.

### E1. Hash-chained audit log primitive

**Question.** When do we ship the append-only hash-chained audit log that `admin.md` mentions throughout?

**Forcing function.** Before VASP authorization (if L1 above resolves "Mutav is a VASP") — Oct 30 2026 latest. Earlier if real investor capital enters production.
**Canonical source.** [`architecture/admin.md`](architecture/admin.md) line 234.

### E2. Square Books-style ledger tables

**Question.** When do we replace ad-hoc balance tracking with `ledger_accounts` + `journal_entries` + `journal_lines` (sum=0 invariant)?

**Forcing function.** When payment collection moves in-house from anchors (today: Etherfuse owns the BRL leg). Architecturally needed before Mutav SA holds investor capital directly rather than routing through TESOURO.
**Canonical source.** Conversation in pricing-module PR (`#72`); pattern from Modern Treasury / Square Books references.

### E3. Daily on-chain ↔ Convex reconciliation job

**Question.** Build the daily reconciliation worker that compares on-chain TESOURO balance to Convex's recorded position per agency.

**Forcing function.** If Mutav is classified as a VASP (L1), BCB Res 521/2025 monthly reporting is already in effect (started May 4 2026) and daily reconciliation is the operational substrate for it. If not, still architecturally required before scale.
**Canonical source.** [`architecture/reliability.md`](architecture/reliability.md) § "Reconciliation"; [`architecture/onchain-integration.md`](architecture/onchain-integration.md).

### E4. Stellar treasury proposal queue UI

**Question.** Build the `treasury/proposals` route in `(admin)` shell — XDR construction, signature collection, Lobstr deep links, submission on threshold. The "Safe-equivalent that doesn't exist on Stellar."

**Forcing function.** Before any real treasury operation hits production. ~1–2 weeks of work.
**Canonical source.** [`architecture/admin.md`](architecture/admin.md) § A3 (line 158) and § A6.

### E5. Money type system upgrades

Five related deferrals, each with its own forcing function:

| Item                                                     | Forcing function                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Branded `Cents` type                                     | Second money type lands (Stroop, USDC)                                                 |
| `currency` sibling field on every `*Cents` schema column | Second currency lands (USD/USDC accounting for investor side)                          |
| Half-up vs half-even rounding policy                     | First NFS-e invoice issuance (Nota Técnica 007/2026 mandates half-even for PIS/COFINS) |
| `RoundingMode` parameter on `Money.mulRate`              | When >1 rounding policy is in play                                                     |
| fast-check property test suite                           | A bug snapshots don't catch, or audit prep                                             |

**Canonical source.** Pricing-module PR `#72` body; conversation captured in session memory.

### E6. Conversion boundary module (`src/lib/money/conversion.ts`)

**Question.** Build `brlCentsToStroopsFloor`, `stroopsToBrlCentsFloor`, etc. as the single boundary for BRL ↔ stroop conversions, with explicit rounding direction in every function name.

**Forcing function.** On-chain settlement code path lands (today: Etherfuse handles this internally).
**Canonical source.** Conversation in pricing-module PR `#72`.

### E7. Versioned rate cards (DB-loaded)

**Question.** Move pricing constants (`SCORE_TIER_RATE`, `COVERAGE_MULT`, etc. from `src/lib/pricing/tiers.ts`) into a `pricing_tables` Convex table with `(version, effective_from, effective_to)` so historical pricing is queryable and rate changes are auditable.

**Forcing function.** First rate change after going live with real customers — or SUSEP nota técnica filing if Mutav is classified that way.
**Canonical source.** Conversation in pricing-module PR `#72`; `src/lib/pricing/tiers.ts`.

### E8. `endToEndId` as natural idempotency key

**Question.** When Pix webhooks land, use the BACEN `endToEndId` (33 chars: `E` + 8-digit ISPB + 12-digit timestamp + 11-char free) as the natural idempotency key for the deposit-create mutation.

**Forcing function.** Pix webhook integration deepens (today: Etherfuse handles webhook idempotency externally).
**Canonical source.** Pricing-module PR `#72`.

### E9. Auth0 wiring

**Question.** Wire Auth0 (decided 2026-05-16, not yet implemented). One-function change in `convex/lib/auth.ts` plus removing `DEV_USER_PUBLIC_ID` from `workspace.tsx`.

**Forcing function.** Before real user accounts. Already planned; tracked in [`docs/auth.md`](auth.md).
**Canonical source.** [`docs/auth.md`](auth.md); [`convex/lib/auth.ts`](../convex/lib/auth.ts).

### E10. Telemetry / alerting infrastructure

**Question.** What service do indexer / cron failures alert into?

**Forcing function.** Before real customer impact — today there are no paying customers but volume is approaching.
**Canonical source.** [`architecture/onchain-integration.md`](architecture/onchain-integration.md) line 353 ("alerting infra TBD").

### E11. Migration trigger thresholds for indexer

**Question.** Define the specific thresholds at which Convex-indexer-based architecture migrates to direct chain reads.

**Forcing function.** Observed UX degradation at specific volume; not a real concern today.
**Canonical source.** [`architecture/onchain-integration.md`](architecture/onchain-integration.md) line 75 (`(TBD) some threshold for (TBD) some user fraction`).

---

## Calendar pins

| Date                   | Event                                                                | Affects                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **May 4, 2026** (past) | BCB Res 521/2025 monthly stablecoin reporting begins                 | Depends on L1 — applies to Mutav directly only if classified as VASP                                                         |
| **May 2026** ongoing   | BCB Resolutions 494–497 IP authorization window                      | L1, L3, V1–V3                                                                                                                |
| **Oct 30, 2026**       | BCB VASP authorization cliff — 270-day transition from Feb 2026 ends | Cannot transact with non-authorized counterparties after this date (L1 question is whether this applies to Mutav itself too) |
| **Dec 2026**           | OpenZeppelin Stellar Smart Accounts audit completion (estimated)     | E4 may use these instead of native multisig if v2                                                                            |

---

## Cross-cutting dependency notes

- **L1 (Mutav VASP classification)** is the single highest-leverage open question. Its answer determines whether several engineering deferrals (E1, E3) flip from "ship before Oct 30 cliff" to "ship eventually."
- **T2 (deposit pricing approach)** has soft links to E5 (currency field): the dual-share-class option pushes USD into the schema sooner, accelerating the multi-currency migration.
- **V2 (Etherfuse B2B extension)** failing pushes V3 (BaaS hedge) from "hedge" to "primary," which changes the conversion boundary (E6) shape.

---

## Recently resolved

_None yet. See the Curator convention at the top: PRs that resolve an item populate this section; the next editor wipes it._
