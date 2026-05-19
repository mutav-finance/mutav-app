# Open Questions

> Master index of unresolved questions across legal, treasury policy, vendor, and engineering. Each entry links to the canonical context. **Architecture supports any answer to most items** — this file exists so the questions don't get re-derived every session.

## Conventions

- **Owner** — who needs to answer (Counsel / Draau / Eng / Vendor / TBD)
- **Blocks** — what's gated on the answer; forcing-function date if any
- **Canonical source** — where the deeper context lives
- **Curator** — whoever lands a PR that resolves an item moves it to `Recently resolved` in the same PR. The next person editing this doc deletes anything sitting in `Recently resolved` before adding their own changes.

---

## Legal & regulatory — pending counsel

> The three-entity model from [`architecture/entities.md`](architecture/entities.md) splits questions that used to be framed as "Mutav SA does X" into per-entity questions. L1 splits into L1a/b/c (per entity), L4 splits into L4a/b/c/d (per investor type / entity tax residence / treaty), and four new questions emerge (L5–L8) from the cross-jurisdictional surface.

### L1a. `Mutav-BR`'s license stack

**Question.** Does `Mutav-BR` (the Brazilian fiança operator) need any BCB license — VASP (Res 519/520/521), payment institution (Res 494–497), or none — or is the Credpago-style fiança model genuinely outside both regimes?

**Why it matters.** Determines whether `Mutav-BR` must hold its own BCB authorization before the Oct 30 2026 cliff. Working hypothesis: outside SUSEP, outside CVM, fiança under Lei do Inquilinato Art. 37 is the legal basis. Needs counsel confirmation; PR mutav#32:26 surfaces this with the same caveat.

**Owner.** External counsel.
**Blocks.** Authorization track scoping for `Mutav-BR`; affects scope of BACEN câmbio reporting role.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) §§ "Per-entity license posture" and "Cessão de recebíveis — economic substance risk".

### L1b. `Mutav-Fund`'s license stack

**Question.** Under the chosen offshore jurisdiction (L5), what fund registration / regulator authorization does `Mutav-Fund` need? Standard offshore-fund admin authorization, or a more restrictive class given the tranched structure?

**Owner.** External counsel in the chosen jurisdiction.
**Blocks.** Fund formation timeline; Subscription Agreement template.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § "Per-entity license posture".

### L1c. `Mutav-Mgmt`'s license stack

**Question.** Under the chosen offshore jurisdiction (L5), what fund-admin registration does `Mutav-Mgmt` need? Whether the admin can co-locate with the Fund (same legal address) or must be independently registered varies by jurisdiction.

**Owner.** External counsel in the chosen jurisdiction.
**Blocks.** Custody chain documentation (the offshore custody pattern in [`architecture/onchain-integration.md`](architecture/onchain-integration.md) § Offshore custody chain assumes independent admin).
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § "Per-entity license posture".

### L2. CVM 175 fund-of-funds applicability (now mostly moot, see L6)

**Question.** Originally: does Mutav SA's two-layer structure trigger CVM 175 Anexo II fund-of-funds rules? Under the new model, this is largely moot because `Mutav-Fund` is offshore and not CVM-regulated as a fund. **The substantive question moved to L6** (marketing the offshore Fund to BR investors).

**Status.** Soft-closed. Replaced by L6. Keep this entry as a back-reference until the offshore-Fund structure is finalized.

### L3. Etherfuse offshore TESOURO holder eligibility — load-bearing

**Question.** Does Etherfuse permit an **offshore entity** (`Mutav-Fund`, in the chosen L5 jurisdiction) to hold TESOURO? Or are TESOURO holders restricted to BR-domiciled entities?

**Why it matters.** **This is the load-bearing dependency for the entire three-entity architecture.** If Etherfuse restricts TESOURO holding to BR-resident entities, the offshore-Fund-holds-TESOURO design breaks. The fallback is to introduce a fourth entity (`Mutav-BR-Treasury`) that holds TESOURO on behalf of `Mutav-Fund` — adds custody chain complexity, may affect the cessão substance question (L8).

**Owner.** Business + Etherfuse partner success; external counsel in dialogue with Etherfuse legal for the formal opinion.
**Blocks.** Final architecture commitment for [`architecture/onchain-integration.md`](architecture/onchain-integration.md) § Offshore custody chain. Currently the doc treats the offshore-holding option as default with the BR-intermediary as fallback.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § "TESOURO as treasury asset"; PR mutav#32:95 raises the same flag.

### L4a. Tax treatment for BR retail (PF) investors in offshore Fund

**Question.** DIRPF declaration requirements for an L4 (qualificado) BR investor PF holding MTVH/MTVM/MTVL: bens no exterior section, ganho de capital cambial, IOF câmbio on resgate, IRRF withholding on distributions (no BR treaty with most offshore jurisdictions).

**Owner.** External counsel + tax advisor.
**Blocks.** Investor-portal tax-disclosure UI for BR PF investors; year-end extrato compatível template (issued by `Mutav-BR` or `Mutav-Mgmt`).
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § CVM — fund regulation across an offshore Fund.

### L4b. Tax treatment for BR institutional (PJ) investors in offshore Fund

**Question.** Variação patrimonial treatment for L5 (profissional, regulated entity) BR investor PJ. IOF câmbio on resgate. Mark-to-market vs accrual depending on the PJ's accounting regime (CPC 48 / IFRS 9). Different from PF treatment in non-trivial ways.

**Owner.** External counsel + tax advisor.
**Blocks.** Institutional onboarding tax-disclosure surface.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § CVM.

### L4c. `Mutav-Fund`'s own tax residence and treaty exposure

**Question.** Tax regime of the offshore Fund itself in the chosen L5 jurisdiction: tax-neutral (Cayman / BVI / Marshall) vs territorial (UAE) vs more complex (Bermuda life-of-fund). Affects fund-level distributions, expense deductibility, audit cost.

**Owner.** External counsel in chosen jurisdiction + tax advisor.
**Blocks.** Fund-level economics modeling; investor disclosure of fund-level tax burden.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § Per-entity license posture.

### L4d. Treaty issues (BR ↔ offshore distribution withholding)

**Question.** Brazil has no tax treaty with most candidate offshore jurisdictions (Cayman, BVI, Bermuda, Marshall, Próspera; UAE has a limited one). Withholding rates on distributions back to BR holders may be material (default 25% IRRF for non-treaty jurisdictions, including tax havens). Specific assessment per chosen jurisdiction.

**Owner.** Tax advisor.
**Blocks.** Distribution / resgate proceeds projection; influences L5 jurisdiction choice.
**Canonical source.** Receita Federal Instrução Normativa on jurisdição de tributação favorecida; verify treaty status per jurisdiction.

### L5. Offshore jurisdiction choice

**Question.** Cayman Islands / BVI / Bermuda / Marshall Islands / UAE-ADGM / Próspera (Honduras) — which jurisdiction does `Mutav-Fund` + `Mutav-Mgmt` register in?

**Why it matters.** Picks the regulator, the fund-admin custody rules, the tax regime (L4c), the treaty surface (L4d), the formation cost, and the speed-to-market. PR mutav#32 lists this as a "Decisão em Aberto"; it should live in this index too.

**Owner.** Draau + external counsel.
**Blocks.** L1b, L1c, L4b, L4c, L4d resolution. Each option has a different regulatory shape.
**Canonical source.** PR mutav#32 `docs/compliance/model-structure.md` Decisões em Aberto.

### L6. Marketing offshore `Mutav-Fund` to BR investors (CVM oferta pública)

**Question.** Can the platform actively market `Mutav-Fund` to BR investors (CVM 88 + 175 oferta pública offshore), or only allow self-directed access? Restricted to qualificados (CVM 175 Art. 4)? Profissionais only (Art. 11)? What's the disclosure / disclosure-language requirement?

**Why it matters.** Determines whether the investor portal can run marketing campaigns in Brazil, whether the UI must geofence or KYC-gate before any product description appears, whether a Subscription Agreement template needs CVM approval. The marketing posture is part of the L8 substance defense.

**Owner.** External counsel (BR securities law).
**Blocks.** Investor-portal marketing copy; landing-page geofencing; Subscription Agreement template; whether MTVH tranche can be offered at all to non-profissional BR investors.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § Marketing offshore Fund to BR investors.

### L7. BACEN câmbio reporting on cross-jurisdiction flows

**Question.** Specific BACEN câmbio reporting requirements for the cessão flow (`Mutav-BR` → `Mutav-Fund`, monthly) and the resgate / default-coverage flow (`Mutav-Fund` → `Mutav-BR`, event-driven). Which BACEN classification — RDE-IED (direct investment), RDE-ROF (loan), RMCCI declaration (financial transfer)? Per-event reporting or monthly summary? Threshold for simplification?

**Owner.** External counsel (BR câmbio law).
**Blocks.** `Mutav-BR`'s câmbio reporting workflow implementation; reconciliation Axis-2 reporting surface.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § BACEN câmbio reporting on cross-jurisdiction flows.

### L8. Cessão de recebíveis — CVM economic-substance risk

**Question.** Does CVM characterize the `Mutav-BR` → `Mutav-Fund` cessão as constituting an irregular FIDC structure (preponderância da realidade), looking through the offshore form to the BR economic substance? Or does the Credpago-style fiança-operator precedent hold?

**Why it matters.** Highest-stakes legal question in the entire structure. An adverse characterization may require restructuring (introducing a BR-domiciled FIDC intermediary, or pulling the Fund onshore). The architecture supports either outcome but the timelines and costs differ.

**Owner.** External counsel (BR securities law).
**Blocks.** Final commitment to the offshore-Fund structure; may force restructure to include a Brazilian FIDC vehicle.
**Canonical source.** [`architecture/regulatory.md`](architecture/regulatory.md) § Cessão de recebíveis — economic substance risk.

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

**Forcing function.** When payment collection moves in-house from anchors (today: Etherfuse owns the BRL leg). Architecturally needed before `Mutav-BR` or `Mutav-Fund` holds investor capital directly rather than routing through TESOURO.
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

- **L3 (Etherfuse offshore TESOURO holder eligibility)** is now the single highest-leverage open question. A "no" answer forces a fourth entity (`Mutav-BR-Treasury`) into the architecture and ripples through `architecture/onchain-integration.md`, `architecture/regulatory.md`, and possibly L8 (cessão substance).
- **L5 (offshore jurisdiction)** chains into L1b, L1c, L4b, L4c, L4d — each is reframed once jurisdiction picks. Counsel can give partial answers in parallel by hypothesizing the jurisdiction set; firm answers wait for the pick.
- **L1a (Mutav-BR VASP/IP classification)** determines whether `Mutav-BR` itself must hold a BCB authorization or just transacts with authorized counterparties. The Oct 30 2026 cliff binds counterparty selection regardless; it binds `Mutav-BR` directly only if L1a resolves "needs license."
- **L6 (CVM marketing) + L8 (cessão substance)** are coupled. A more restrictive marketing posture (only-qualificado oferta pública) strengthens the L8 substance defense; a broader posture (treating BR as a passive market) weakens it.
- **T2 (deposit pricing approach)** has soft links to E5 (currency field): the dual-share-class option pushes USD into the schema sooner, accelerating the multi-currency migration.
- **V2 (Etherfuse B2B extension)** failing pushes V3 (BaaS hedge) from "hedge" to "primary," which changes the conversion boundary (E6) shape. Also intersects with L3 — if Etherfuse cannot support offshore TESOURO holding, the BaaS hedge path may need to deliver USDC into a BR-intermediary instead of directly into `Mutav-Fund`.

---

## Recently resolved

_None yet. See the Curator convention at the top: PRs that resolve an item populate this section; the next editor wipes it._
