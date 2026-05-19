# Regulatory Architecture — Brazil + Offshore

> Mutav operates as a composite of three legal entities across two jurisdictions (see [`entities.md`](entities.md)): `Mutav-BR` (Brazilian operator, fiança under Lei do Inquilinato), `Mutav-Fund` (offshore, holds TESOURO and issues the three tranches), and `Mutav-Mgmt` (offshore, administrator). Each carries a distinct regulatory posture. This document defines the regulatory floor the architecture must support across all three — Brazilian law for `Mutav-BR` plus the cross-jurisdictional surface where the entities interact — and the architectural choices that follow from each. It is not a legal compliance plan; it is the set of architecture constraints that fall out of the regulatory reality. Operational compliance (filings, vendor contracts, opinions) is out of scope.

The regulatory landscape as of 2026 is the most concrete it has been: BCB Resolução 519/2025 is in force, CVM Resolução 175 governs Brazilian tokenized fund structures, BCB Resolução 521/2025 monthly stablecoin reporting started May 4, 2026, and CVM's 2026 agenda explicitly includes tokenization rules. Architecture decisions made now should anticipate scrutiny within 12–24 months.

## Per-entity license posture (working hypothesis)

The full per-entity questions are tracked in [`../open-questions.md`](../open-questions.md) §§ L1a/b/c, L4a/b/c/d, L5, L6, L7, L8 — all pending external counsel. This table captures the _working hypothesis_ that drives the architecture; nothing here is a legal opinion.

| Entity       | Likely posture                                                                                                                                                                                                                         | Open question   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `Mutav-BR`   | Outside SUSEP (not seguradora) and CVM (not fundo) because the fiança model under Lei do Inquilinato Art. 37 is not insurance and not fund administration. Subject to LGPD, ISS municipal, BCB câmbio reporting on offshore transfers. | L1a, L7, L8     |
| `Mutav-Fund` | Not CVM-regulated as a fund (CVM 175 is a BR construct; offshore funds are regulated by their domicile authority — Cayman CIMA / BVI FSC / Bermuda BMA / etc.). Offering to BR investors does trigger CVM rules (see § Marketing).     | L1b, L3, L5, L6 |
| `Mutav-Mgmt` | Same offshore jurisdiction as `Mutav-Fund`. Likely needs fund-admin registration in that jurisdiction.                                                                                                                                 | L1c, L5         |

The three-entity split was chosen partly to keep `Mutav-BR` outside the fund regulatory perimeter (mirroring Credpago precedent for the fiança operator) and partly to put the investor-facing fund in a jurisdiction more accommodating to tokenized tranches than CVM 175 currently is in Brazil. The cost is the cross-jurisdictional reporting and substance scrutiny addressed in §§ BACEN câmbio reporting and Cessão de recebíveis below.

## LGPD — data protection

Brazil's general data protection law (Lei Geral de Proteção de Dados) sets the floor for handling personal data. Applies to any entity handling PII of Brazilian residents — so `Mutav-BR` directly (it operates in Brazil), and `Mutav-Fund` / `Mutav-Mgmt` to the extent they process PII of BR investors.

> The "how" of the constraints below — the two-key envelope + hash sidecar pattern, the V8/Node runtime split, the key management lifecycle from env-derived dev to managed-secret production, anti-patterns enforced by lint — lives in [`security.md`](security.md). This section defines what LGPD requires; `security.md` defines how the architecture meets it.

### Architectural constraints

1. **Cross-border data transfer is allowed with disclosure.** Convex is hosted in the US (AWS). LGPD does not strictly require BR residency for personal data, but cross-border transfer requires (a) a documented legal basis — typically Standard Contractual Clauses (SCCs), (b) disclosure in the privacy policy, (c) data subject notification on first use. The cross-jurisdictional flow (BR investor → Mutav-Fund offshore) is itself a cross-border transfer that LGPD covers.
2. **Sensitive PII stays at the source where possible.** Biometric KYC payloads, full ID document images, raw face-match scores never leave the KYC vendor's infrastructure. Convex stores only `kycStatus` (status enum) and `kycRef` (vendor's verification id). The vendor is the data processor; the controlling entity (`Mutav-BR` for tenant data; `Mutav-Fund` for investor data) is the data controller for the relationship; the vendor's KYC archive is queried on demand via API for audit purposes, not bulk-replicated.
3. **Right to erasure (Art. 18, IX).** Investors and agency staff have the right to request deletion of personal data. The architecture must support a `eraseUserData` action that scrubs PII fields across all domains where they appear, retaining only the minimum required for regulatory record-keeping (audit log entries with hashed-anonymized actor refs, financial transaction history with a tombstone for the user). Erasure is a workflow (see [`reliability.md`](reliability.md)) — it touches multiple domains and may cross entity boundaries (PII held by `Mutav-BR` vs. by `Mutav-Fund` follows different retention floors); partial failure must be detectable and resumable.
4. **Data minimization by domain.** The auth wrapper's `ctx.user` exposes only fields needed for authorization (`_id`, `name`, `email`, role). Sensitive PII is never loaded into the wrapper. Handlers that need it fetch deliberately.
5. **Audit logs record access to PII.** Reads of agency staff PII or investor PII produce audit log entries — not for protection (Mutav-internal staff are trusted) but for forensic visibility when an LGPD complaint asks "who saw my data when".

### Vendor selection follow-on

KYC vendor selection must satisfy LGPD criteria, not just functional fit:

- BR data residency option (sensitive data stays in country)
- ANPD-registered (Brazil's data protection authority)
- Documented data retention and deletion practices
- API for data subject erasure requests
- SCC-compatible if processing happens cross-border

This narrows the field to BR-native providers (Unico, Caf, Datavalid, Didit) or international providers with BR-resident options (some Onfido/Veriff configurations). It rules out KYC providers without a documented BR residency story.

### LGPD-adjacent: privacy policy and ToS

Out of scope architecturally but operationally required: a documented privacy policy declaring the cross-border transfer to Convex, the KYC vendor processor relationship, the data retention schedule, the erasure procedure, **and the cross-entity data flow** (which PII goes from `Mutav-BR` to `Mutav-Fund` for investor onboarding). These are legal artifacts; the architecture must enable them.

## BCB Resolução 519/2025 — KYC and VASP authorization

BCB 519/2025 (in force 2025) consolidated Brazilian crypto regulation. The KYC floor it sets is non-negotiable for any consumer-facing crypto service operating in Brazil.

**Scope across the three entities.** BCB 519/2025 binds Brazilian VASPs. `Mutav-BR` is not a VASP if it doesn't custody crypto (working hypothesis L1a — Etherfuse holds the crypto leg on `Mutav-BR`'s behalf during cessão settlement). `Mutav-Fund` and `Mutav-Mgmt` are offshore and not BCB-regulated directly. But BCB rules still propagate via two paths: (a) Mutav's BR-based counterparties (Etherfuse, BaaS hedge providers) must be BCB-authorized, and (b) BR investors interacting with `Mutav-Fund` create reporting obligations on the BR side.

### Architectural constraints

1. **No anonymous interaction with funds.** Every investor must be CPF-identified (PF) or CNPJ-identified (PJ) before any deposit. The investor portal architecture in [`investor.md`](investor.md) reflects this — wallet-as-identity for read; KYC-gated for deposit and redeem; "deposit without KYC" is not a valid v1 path even though it's technically possible with wallet-as-identity. KYC is collected by the platform on behalf of `Mutav-Fund`; the Subscription Agreement uses the KYC artifact.
2. **Counterparty authorization gating.** BCB has the power to block IP ranges and disconnect non-compliant VASPs from the payment system. Mutav's counterparties on the BR side (Etherfuse, Bitso, Transfero, Foxbit) must hold their authorizations under both the new VASP framework (Res 519/520/521) and the IP framework (Res 494–497). The Oct 30, 2026 cliff binds _counterparty_ selection, not `Mutav-BR` itself (under the working hypothesis).
3. **Regulatory pause.** The architecture must support a "regulatory pause" — admin action that halts all deposit/redeem flows while preserving fund state. This is the same circuit-breaker primitive used for reconciliation mismatches (see [`reliability.md`](reliability.md) § Reconciliation). The pause can scope per-entity (e.g., pause `Mutav-Fund` inflows while `Mutav-BR` operations continue) per the kill-switch dimensions in [`compliance.md`](compliance.md).
4. **CPF as canonical user identifier.** Once KYC is complete, the CPF (or CNPJ) becomes the canonical identifier for that investor profile. Multiple wallets across chains can be linked to the same CPF — but per the wallet-as-identity-per-chain model in [`investor.md`](investor.md), this linking is documented (so the architecture can support per-CPF aggregation for tax reporting) but doesn't unify identity across chains for operational purposes.
5. **Source-of-funds checks.** BCB 519/2025 requires VASPs to track source of funds. Architecture: every deposit's `correlationId` (see [`reliability.md`](reliability.md) § Reconciliation) chains back to a bank-confirmed BRL deposit. The chain of custody from Brazilian bank account → Pix → Etherfuse → onchain mint → `Mutav-Fund` recorded position is documented at every step.

### KYC vendor selection criteria

BCB 519/2025 plus LGPD requirements narrow the vendor field. Architectural requirements for any KYC provider integration:

- **Biometric liveness at ISO/IEC 30107-3 PAD Level 2 or higher** — required by BCB for retail crypto
- **Source-of-truth checks against SERPRO / Receita Federal** — typically via Datavalid; either direct or through an aggregator
- **Documented LGPD-compliant data handling** — see § LGPD above
- **COAF reporting integration** — Brazil's FIU receives suspicious activity reports; the KYC vendor should support this or the architecture must
- **API stability + SLA** — KYC vendor downtime blocks redeem; the architecture supports a fallback (see § KYC vendor abstraction below)
- **BR data residency option** (or documented ANPD-approved SCC mechanism)

### Recommended vendor: Sumsub (scoped B2B)

**For Mutav's qualified-investor + institutional scope, the recommendation is Sumsub** ([sumsub.com](https://sumsub.com)). The product fits — global compliance pedigree, real reusable-KYC across products, iBeta PAD Level 2 liveness, strong API + webhook reliability, mature COAF SAR generation. The pricing tier (Compliance: $1.85/verification + $299/mo minimum) is rounding error at hundreds-of-verifications-per-month institutional volume.

**Three commitments to confirm with Sumsub sales before signing the DPA:**

1. **LGPD DPA with ANPD-approved SCCs** — Sumsub holds ISO 27001/27017/27018 + SOC 2 Type II, but does not publicly advertise ANPD registration or a BR-resident data option. ANPD's mandatory SCC framework (effective 2025-08-23) requires explicit confirmation that Sumsub's DPA uses ANPD-approved SCCs, not just EU SCCs. Push for EU data residency at minimum, ask about a BR region.
2. **COAF SISCOAF export format** — Sumsub generates "ready-to-file" SAR/STR reports, but native SISCOAF-format export is not in the public docs. Confirm format before assuming filing can be automated; if not, Mutav's compliance team files manually from Sumsub's output.
3. **CNPJ + SERPRO/Datavalid coverage** — Sumsub's public BR docs detail CPF verification (the `bra_gov_cpf` E_KYC check), but CNPJ direct verification and SERPRO/Datavalid integration are not advertised the way they are for BR-native vendors (Didit, Unico, Caf). Confirm CNPJ source-of-truth coverage for the institutional onboarding flow.

**Scope boundary.** Sumsub's pricing breaks at retail-at-scale (>10k verifications/month). If Mutav ever expands to a retail consumer surface, re-evaluate against **Didit** ($0.30/verification, 500 free/mo, explicit SERPRO + Datavalid, COAF-formatted output) or a BR-native (Unico, Caf, Idwall). The KYC vendor abstraction below makes that swap viable.

**Sanctions/PEP screening** comes in-house with Sumsub's Compliance tier (global watchlists + adverse media + ongoing monitoring). No separate Refinitiv World-Check or Dow Jones contract needed for v1.

### KYC vendor abstraction

To avoid hard-coupling the architecture to a single vendor:

- The `compliance` Convex domain (per [`compliance.md`](compliance.md)) exposes a stable interface (`startVerification`, `getStatus`, `getRef`, `revoke`) that the rest of the system calls
- Vendor-specific clients live in `convex/compliance/providers/{sumsub,didit,unico}.ts` and implement the interface
- Vendor selection is a configuration choice, not a code change
- Multiple vendors can be active simultaneously (Sumsub for L4/L5 institutional `Mutav-Fund` subscribers; a BR-native for L1/L2 if Mutav adds retail surface)

This matches the pattern already in place for anchors (`src/lib/anchors/registry.ts` + per-provider clients).

## CVM — fund regulation across an offshore Fund

CVM Resolução 175 (effective 2023, ongoing amendments) consolidates Brazilian fund regulation. It governs **Brazilian-domiciled** funds. Because `Mutav-Fund` is offshore (see [`entities.md`](entities.md)), CVM 175 does _not_ regulate it as a fund. But CVM still has multiple touchpoints with the architecture:

1. **Marketing to BR investors** (§ "Marketing offshore Fund to BR investors" below) — CVM regulates the _offering_, regardless of fund domicile.
2. **The substance of the cessão** (§ "Cessão de recebíveis — economic substance") — CVM may look through the offshore form to see a FIDC-like structure.
3. **TESOURO holding eligibility** (§ "TESOURO as treasury asset" below) — TESOURO is Etherfuse's tokenized BR Treasury bond; whether an offshore entity can hold it depends on Etherfuse's CVM/BCB authorizations and any holder restrictions therein.

CVM's 2026 agenda explicitly addresses tokenized fund structures (gov.br/cvm), so the regulatory surface in Brazil for offshore funds offering to BR investors is actively evolving — architecture decisions should anticipate scrutiny within 12–24 months.

### Architectural constraints

1. **Segregated account topology is a regulatory expectation, not just a software pattern.** Offshore fund-admin custody rules (Cayman CIMA Rule 2.3, BVI Fund Admin Code, similar elsewhere) require strict separation between fund assets and the administrator's operational assets. Software-wise this means: separate Soroban contracts for fund custody (`Mutav-Fund`) and operational logic (mint authority, NAV updater, liquidation executor — owned by `Mutav-Mgmt`), with the operational contracts having narrow approval-gated access to custody. This matches the ERC-4626 vault pattern on EVM and is the topology Centrifuge, Maple v2, Goldfinch, and Ondo all use.
2. **NAV calculation must be reproducible by an external auditor.** The audit log captures NAV update inputs (per-tranche active layer value, liquidity layer value, outstanding shares) — see [`tranches.md`](tranches.md) and [`reliability.md`](reliability.md) § NAV safety. An auditor with read access to the historical audit log can reconstruct every NAV update.
3. **Reconciliation between `Mutav-Mgmt`'s books and onchain state is required.** `Mutav-Fund`'s recorded position must match the on-chain TESOURO balance at every snapshot; `Mutav-BR`'s 80% cessão outflow must match `Mutav-Fund`'s inflow. Discrepancies pause the fund. See [`reliability.md`](reliability.md) § Three-axis reconciliation.
4. **Investor records are retained.** Offshore jurisdictions typically require 5-10 years retention; CVM requires 5 years for BR investors. Erasure (LGPD Art. 18) is constrained — the erasure procedure preserves the minimum regulatory-required record (transaction history, KYC verification proof, Subscription Agreement) with PII anonymized.
5. **Reporting surface.** The offshore Fund files periodic reports to its domicile regulator (cadence and format depend on L5 jurisdiction choice). Architecture must support extracting these from the audit log + financial state without ad-hoc data archaeology. `@convex-dev/aggregate` is the right primitive for materialized financial totals.

### TESOURO as treasury asset — offshore holding question

`Mutav-Fund` holds **TESOURO**, Etherfuse's tokenized Brazilian Treasury bonds, as its sole treasury asset. Two architectural implications:

**Two-layer tokenized claim.** Investors hold MTVH/MTVM/MTVL → those represent a claim on `Mutav-Fund` → which holds TESOURO → which represents a claim on Brazilian Treasury bonds. Even though `Mutav-Fund` is offshore and not CVM-regulated as a fund, the _economic_ layering looks like fund-of-funds. Whether Brazilian regulators care about this layering when BR investors are subscribed (vs only international investors) is open per L6.

**Offshore holder eligibility — the load-bearing question.** TESOURO is issued by Etherfuse, which holds BR regulatory authorizations under CVM and BCB. Whether Etherfuse permits an _offshore entity_ to hold TESOURO (vs restricting to BR-resident holders) is a hard dependency on Etherfuse partner success — see L3 / P3 in [`../open-questions.md`](../open-questions.md). If the answer is no, the architecture inserts a fourth entity (`Mutav-BR-Treasury`) that holds TESOURO on behalf of `Mutav-Fund`, with a corresponding update to the cessão flow.

Until L3 resolves, the architecture assumes offshore-Fund holding works. The implementation-level pieces ([`onchain-integration.md`](onchain-integration.md) § Offshore custody chain) are designed to absorb either outcome with minimal rework.

## Marketing offshore Fund to BR investors

Even though `Mutav-Fund` is offshore and not CVM-regulated _as a fund_, CVM regulates the _offering_ of any investment product to Brazilian residents. The framework:

- **CVM Resolução 88** (and successors) — rules on oferta pública of foreign securities to BR investors. Caps on amounts, classifications of permitted investors, registration requirements depending on offering shape (broadcast public offer vs. restricted to qualificados vs. private placement to invited investors).
- **CVM Resolução 175** — qualified-investor definitions (Art. 4 qualificado, Art. 11 profissional) determine which BR investors can subscribe to offshore funds without triggering full public-offer registration.

### Architectural implications

1. **Subscription Agreement gating by BR investor class.** A BR L4 (qualificado) investor can subscribe to `Mutav-Fund` under the "restricted to qualified investors" oferta pública carve-out. A BR L5 (profissional) investor has even fewer restrictions. A BR L2 (retail) investor cannot subscribe at all unless `Mutav-Fund` registers a full public offer in Brazil (operationally infeasible for v1). The platform UI enforces this; the Subscription Agreement records it.
2. **Marketing copy and disclosures.** Any UI surface accessible to a BR investor that describes `Mutav-Fund` is regulated marketing. Specific CVM-prescribed disclosures (risk, fee schedule, NAV history, liquidity terms) must appear in standard format. Anti-marketing language in copy ("we do not target Brazilian retail investors") is not enough if the platform is reachable from Brazil and accepts BR investors — geofencing or KYC-gating is required.
3. **Tranche access overlays the BR investor class.** MTVH eligibility (qualificado or profissional) intersects with the oferta pública classification. The two regimes apply simultaneously to BR investors; the most restrictive wins.
4. **Documentation trail.** Each BR investor's CVM classification status is stored on their account (per [`compliance.md`](compliance.md) L4/L5 verification level) and referenced from the Subscription Agreement that the investor signs with `Mutav-Fund`. The cross-jurisdictional link is audit-logged.

## BACEN câmbio reporting on cross-jurisdiction flows

Every BRL ↔ crypto ↔ offshore-Fund transfer crosses BACEN's câmbio reporting perimeter. Two flows have ongoing obligations:

### Cessão settlement flow (monthly, BR → offshore)

```
Mutav-BR receives BRL fees from imobiliárias
       │
       ▼
80% routed to Mutav-Fund via Etherfuse
       │ (BRL → TESOURO mint at Etherfuse, into Mutav-Fund's Stellar address)
       ▼
This is a câmbio operation: BRL → foreign-currency-equivalent (TESOURO is BRL-denominated
but issued by an entity with foreign ownership exposure; the offshore holder is what
triggers BACEN reporting, not the asset's denomination).
```

**Architectural commitment.** Each cessão settlement event produces a câmbio-reporting record: BRL amount, USD-equivalent at execution-time rate, counterparty Etherfuse, beneficiary `Mutav-Fund`, correlation id chain. The records are extractable from the audit log; format is whatever BACEN currently requires (e.g., RDE-IED for direct investment, RDE-ROF if loaned, RMCCI declaration if treated as financial transfer — the operational classification is open per L7).

### Resgate / default coverage flow (event-driven, offshore → BR)

```
Mutav-Fund liquidates TESOURO at Etherfuse
       │ (TESOURO burn → BRL out, into Mutav-BR's BR bank account)
       ▼
Mutav-BR pays imobiliária (default coverage) or investor (resgate)
```

**Architectural commitment.** Same câmbio reporting surface in reverse. The deposit on the BR side has documented origin (specific Mutav-Fund liquidation event with correlation id).

### Open per L7

Whether câmbio reporting can be batched (e.g., monthly summary per cessão) or must be per-event, and which specific BACEN classification applies, is open per [`../open-questions.md`](../open-questions.md) L7. The architecture preserves enough granularity (correlation ids, timestamps, amounts both currencies) to support either answer.

## Cessão de recebíveis — economic substance risk

`Mutav-BR` ceding 80% of receivables to `Mutav-Fund` is, at the contract level, a routine cessão de recebíveis (Code Civil Art. 286 et seq.). But the _economic substance_ of "an operator periodically transfers receivables to a fund vehicle that issues tranched securities backed by those receivables" matches exactly the structure of a FIDC (Fundo de Investimento em Direitos Creditórios — CVM 175 Anexo II).

**The doctrine.** Brazilian regulators apply preponderância da realidade — when the legal form (offshore Fund + cessão contracts) differs from the economic substance (BR-investor-funded securitization of BR receivables), the regulator may look through the form. If CVM characterizes this structure as constituting an irregular FIDC (an unregistered Brazilian-domiciled FIDC offering tranched securities), the consequences are significant — including potentially treating `Mutav-Fund` as a de facto Brazilian fund.

**Architectural implications.** This isn't an architectural decision per se — the architecture supports the cessão flow either way. But the architecture must:

1. **Preserve enough audit detail to defend the offshore-Fund characterization** if challenged. Every cessão settlement records: the specific receivables transferred (contract IDs, period, amounts), the price (was it fair value? deeply discounted? face?), the relationship between `Mutav-BR` and `Mutav-Fund` (arm's length? same ownership? formal cessão contract with explicit terms?). All of this lives in the cross-entity audit log per [`reliability.md`](reliability.md).
2. **Not present the offshore Fund as a marketing tool to BR investors that look like FIDC subscribers.** The marketing posture (see § Marketing above) and the investor classification gate are part of the substance defense.
3. **Allow restructuring if CVM forces the issue.** If counsel concludes the substance risk is material, the architecture can absorb a fourth entity (e.g., a BR-domiciled FIDC that holds the receivables and the offshore Fund holds shares in the FIDC). This is L8 in [`../open-questions.md`](../open-questions.md).

The working hypothesis is that the cessão characterization holds — the Credpago-style fiança operator model is established and not treated as FIDC by regulators. But this is the highest-stakes legal question in the entire structure.

## Settlement provider selection (agency → Mutav-Fund)

The settlement provider handles **agency → Mutav-Fund** monthly B2B flows: agencies pay `Mutav-BR` fees in BRL via Pix; 20% stays with `Mutav-BR`; 80% flows on to `Mutav-Fund` as cessão, ultimately denominated in TESOURO on Stellar. Pattern documented in [`onchain-integration.md`](onchain-integration.md) § Agency settlement.

**Primary rail: Etherfuse.** Because `Mutav-Fund`'s treasury is TESOURO (Etherfuse's tokenized Brazilian Treasury bond), Etherfuse mints TESOURO directly from inbound Pix via SEP-6 — single counterparty, no intermediate stablecoin hop. The same Etherfuse primitive serves investor on-ramp; the difference for agency settlement is the destination address (`Mutav-Fund`'s Stellar treasury) and the trigger (system-driven from `Mutav-BR`'s cessão schedule, not user-driven UI).

**Hedge rails: BaaS providers** — Transfero / Bitso / Foxbit — exist for capacity, concentration, and incident continuity. They use a multi-hop (Pix → BaaS → USDC → Stellar → Etherfuse mint TESOURO into `Mutav-Fund`) that adds spread; that's the cost of the hedge.

### Required architectural properties (any rail)

- **BCB Payment Institution authorization** (existing IP license per Resolution 4.282/2013, OR will hold under the new IP regime per Resolutions 494/495/496/497 with May 2026 authorization window). Unauthorized providers cannot legally handle BRL float for `Mutav-BR` after the October 30, 2026 cliff.
- **VASP authorization under BCB Resolutions 519/520/521** (Nov 2025). `Mutav-BR` cannot transact with non-authorized VASPs after the cliff; the transition window is 270 days from Feb 2026.
- **API + webhook reliability** — REST API; webhooks for each lifecycle event with correlation ids preserved end-to-end. The correlation id is mandatory; without it, reconciliation per [`reliability.md`](reliability.md) § Reconciliation is not possible.
- **Stellar address coverage** — the rail must be able to deliver to `Mutav-Fund`'s Stellar address (TESOURO mint for Etherfuse; USDC for BaaS rails which then route through Etherfuse for the final TESOURO conversion).
- **Travel Rule compliance** (mandatory domestic per Resolution 520).
- **MED 2.0 readiness** — provider notifies promptly on MED reversals via webhook; Mutav's quarantine pattern depends on it.

### Shortlist (Brazilian B2B Pix-to-crypto, 2026)

| Provider              | Role            | Status                                                                                           | Notes                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Etherfuse**         | **Primary**     | Existing Mutav investor on-ramp; TESOURO issuer; status under new BCB frameworks to be confirmed | Single-counterparty rail BRL Pix → TESOURO direct via SEP-6. Already in the architecture for investor on-ramp; extending to `Mutav-BR` agency settlement is configuration + endpoint reuse, not a new integration. Concentration risk acknowledged — see hedge rails below.                       |
| **Transfero BaaSiC**  | Hedge candidate | BCB Payment Institution (Sept 2023). VASP re-application pending under new framework.            | Issues BRZ (multichain stablecoin incl. Stellar). 13M+ tx in 2023. Three-call orchestration (Pay-In → Trade → Crypto-Out). Stellar-native USDC in one hop is **not publicly documented** — confirm in sandbox. Pricing opaque (gated by sales). Customers include Bitget, BRX Finance, Stakease.  |
| **Bitso Business**    | Hedge candidate | Mexico-HQ, established BR operations.                                                            | Single-API BRL → USDC with "just-in-time" settlement. Processed $6.5B in US-MX remittances 2024 (mature reconciliation story). Strongest BaaS-side competitor. Webhook + correlation-id story likely cleaner than Transfero's. Already named as the fallback investor on-ramp per project memory. |
| **Foxbit Prime Desk** | Hedge candidate | BR-native, member of BRL1 consortium.                                                            | "Invisible stablecoin" B2B FX product. REST OTC API. Quote-driven pricing. Good fit if volume is large enough to negotiate.                                                                                                                                                                       |

**Out of consideration:**

- **Stripe + EBANX Pix** — fiat acquiring only; stablecoin balances are US-issued, not delivered onchain to arbitrary addresses. Wrong tool.
- **Mercado Bitcoin OTC** — quote-driven OTC, not a productized B2B settlement rail with webhooks.
- **BRL1 consortium** — the stablecoin itself, not a settlement product; rails are the member exchanges (Bitso, Foxbit).

### Etherfuse concentration — architectural acknowledgment

Etherfuse currently fills four roles in the Mutav architecture, mapping to specific entities:

| Role                            | Mutav entity counterparty | Notes                                                                 |
| ------------------------------- | ------------------------- | --------------------------------------------------------------------- |
| Investor on-ramp                | `Mutav-Fund`              | Investor deposits land in `Mutav-Fund`'s Stellar address as TESOURO   |
| Agency settlement primary rail  | `Mutav-BR` → `Mutav-Fund` | BRL in to `Mutav-BR`'s account, TESOURO out to `Mutav-Fund`'s address |
| TESOURO issuer                  | `Mutav-Fund`              | The asset Mutav-Fund holds is Etherfuse's product                     |
| TESOURO redemption counterparty | `Mutav-Fund`              | Burn TESOURO at Etherfuse → BRL out (default coverage, resgate)       |

This is concentrated counterparty exposure. The architectural hedges:

1. **Active BaaS hedge integration** — at least one (Bitso or Transfero) is wired and exercised periodically, even if Etherfuse handles steady-state volume. The hedge is not "we'll integrate when Etherfuse goes down" — that integration must work the first time it's needed.
2. **Bitso BRL1 as fallback investor on-ramp** per project memory — independent of agency settlement, addresses the on-ramp side of the concentration.
3. **Operational visibility into Etherfuse health** — `Mutav-Mgmt` operations staff monitor Etherfuse capacity, response latency, error rates; alerts fire before degradation forces hedge-rail activation.
4. **Documented runbook for hedge-rail activation** — exactly how Mutav switches from Etherfuse-primary to BaaS-hedge for agency settlement, including the operational steps and the resulting end-to-end latency expectation.

This is a real trade-off the architecture accepts in exchange for the simplicity of TESOURO-as-treasury. If concentration becomes untenable, the alternative is multi-asset treasury (TESOURO + USDC + others), which is a much more complex architecture than the hedge layer. The Etherfuse concentration is also the load-bearing dependency for L3 (offshore holder eligibility — see § TESOURO above).

### Settlement provider abstraction

Same pattern as KYC and anchor abstractions:

- `convex/settlement/providers/{etherfuse,transfero,bitso,foxbit}.ts` implement a stable interface (`createPayIn`, `getQuote`, `executeTrade`, `deliverCrypto`, `getStatus`, `handleReversal`)
- Provider role (primary vs hedge) is a configuration property
- Vendor selection is a configuration choice per agency, per fund, or per settlement event
- Multiple providers can coexist (Etherfuse primary, Bitso warm-standby, Transfero/Foxbit available for capacity expansion)

### Critical due-diligence checklist before signing any provider

1. **Authorization status under both Nov 2025 VASP framework and May 2026 IP framework** — confirm provider is on track for both. `Mutav-BR` cannot transact post-cliff (Oct 30, 2026) with non-authorized providers.
2. **Webhook event catalog including crypto-out / on-chain delivery events** — confirm correlation id propagates end-to-end. If only Pay-In gets a webhook and crypto-delivery requires polling, that's a reconciliation tax.
3. **MED reversal notification SLA** — how fast does the provider notify; what's the format. Mutav's quarantine clock depends on this signal.
4. **Travel Rule data handling** — confirm provider collects and stores; confirm what `Mutav-BR` receives and must store independently.
5. **LGPD DPA with ANPD SCCs** — same expectation as KYC vendor selection above.
6. **Pricing model** — spread on Trade, per-tx fees, monthly minimums. Volume projections inform shortlist ranking.
7. **Stablecoin delivery options** — native USDC on Stellar (one-hop preferred); BRZ → USDC routing if not.
8. **Slippage controls on Trade endpoint** — confirm a max-slippage parameter exists and rejected trades roll back cleanly.

## Audit trail expectations

The hash-chained, Merkle-anchored audit log defined in [`reliability.md`](reliability.md) § Audit log integrity satisfies CVM, BCB, and offshore-jurisdiction expectations for forensic defensibility. The architectural commitment, with three-entity awareness:

- Every state-affecting Mutav-internal action produces an audit entry tagged with the originating entity (`MUTAV_BR` / `MUTAV_FUND` / `MUTAV_MGMT`) so post-hoc reconciliation can split by entity
- Entries are hash-chained — any tampering invalidates the chain forward of the tampered entry
- Daily Merkle roots are anchored on Stellar — external auditors verify by re-deriving and comparing
- The audit log is queryable by actor, target, time range, **and entity** — supports both regulator inquiries (which may be entity-specific: CVM inquires about `Mutav-Fund` operations, BACEN inquires about `Mutav-BR` flows) and internal investigations
- Retention is open-ended for audit entries (small footprint per entry); investor PII referenced by entries is anonymized when the related investor's data is erased

The 5-year CVM retention requirement for BR investor records is met by the audit log + transaction history; offshore jurisdiction retention floors may differ (typically 7-10 years for Cayman / BVI fund admin); PII fields are anonymized on LGPD erasure, but the financial events themselves remain.

## Multisig governance

Treasury operations (NAV updates, liquidations, contract upgrades, signer set changes) require multisig consensus per [`onchain-integration.md`](onchain-integration.md) § Write architecture. The constraints from a regulatory perspective, now per-entity:

1. **Signer sets are documented externally per entity.** `Mutav-Fund`'s signer set is documented in its offshore fund-admin agreement and ultimately controlled by `Mutav-Mgmt`. `Mutav-BR`'s signer set (for any BR-side multisig — e.g., the BACEN câmbio reporting submitter) is documented in `Mutav-BR`'s operating agreement. Changes to either set are themselves multisig operations that produce audit entries.
2. **No single signer can move funds.** The threshold is set such that a compromise of one signer cannot drain the fund. Standard: 3-of-5 weighted with geographic / role diversity in the signer set.
3. **Key ceremony is documented per entity.** Initial signer key generation, rotation procedures, recovery procedures are operational artifacts but the architecture must support them — every signer change is an admin operation producing audit entries scoped to the relevant entity.
4. **Cross-entity multisig may be required for specific operations.** A liquidation that triggers payout from `Mutav-Fund` to `Mutav-BR` may require co-signers from both entities (one to authorize the offshore-side liquidation, one to confirm the BR-side receipt). The architecture supports cross-entity signer-set composition for specific operation classes; the operational policy on which operations require it is in [`admin.md`](admin.md) § A3.

### Stellar implementation pattern (hybrid leaning native-first)

Stellar's native multisig (classic G-account with weight-based m-of-n: signer weights 1–255, three operation thresholds Low/Med/High, up to 20 signers) is **the production primitive in 2026** and what major protocols (Aquarius Signers Guild, Blend, FxDAO) actually run for treasury. Soroban smart accounts (CAP-46-5 custom-account interface) and the OpenZeppelin Stellar Smart Accounts crate are the new modern primitive — production-ready, audited via the SDF×OpenZeppelin partnership through Dec 2026 — but they coexist with native multisig rather than replace it.

**Recommendation for Mutav-Fund treasury (the load-bearing case):**

- **Treasury account: classic G-account with native multisig** (3-of-5 weighted, controlled by `Mutav-Mgmt` signers per § Multisig governance above). Battle-tested, every Stellar wallet understands it, audit trail at the protocol level, zero contract risk. Soroban contracts (NAV updater, liquidation executor) accept this G-account as the admin/owner — multisig auth on classic accounts propagates into Soroban via standard `require_auth`. No custom smart-account contract needed for treasury ops.
- **Signer wallet: Lobstr Vault** for each `Mutav-Mgmt` ops staff member. Mobile-first, push notifications per pending transaction, biometric approval. The closest thing to a Squads/Safe signer experience on Stellar. Add Freighter as a desktop backup signer for each role.
- **Proposal/queue UI: built inside Mutav's `(admin)` shell** (~1–2 weeks of work). A `treasury/proposals` route that constructs the XDR, persists pending transactions in Convex with collected signatures, exposes a "Sign on Lobstr" deep link per signer, and submits the transaction once threshold is met. This is the Safe-equivalent that doesn't yet exist on Stellar. Details in [`admin.md`](admin.md) § A3/A6.

**Defer Soroban smart accounts (OpenZeppelin / kalepail's `smart-account-kit`) to v2** — they're the right primitive for **investor-facing** passkey onboarding (where Meridian Pay has shipped 1k+ users), but for treasury the surface area of an unaudited custom-account contract isn't worth the UX gain over native multisig + Lobstr.

**Not recommended for treasury:**

- `kalepail/passkey-kit` (now legacy/demo, unaudited)
- StellarGuard (co-signer-as-a-service, not a multi-party proposal queue)
- `multisigstellar/multisig` (lightweight coordinator, not a full queue — useful as reference for the Mutav-built UI)
- SEP-30 (RecoverySigner is for user account recovery, not treasury control plane — different problem)

**2026 changes worth re-checking before build:** Protocol 26 (CAP-77 Quorum Freeze, CAP-82 256-bit math), OpenZeppelin Stellar Smart Accounts audit completion timeline, Lobstr full Soroban transaction parsing release.

## Architectural decisions that follow from this doc

Summary of constraints the regulatory floor imposes on architecture (entity-aware):

| Constraint                          | Architectural commitment                                                                   | Where it lives                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| LGPD cross-border disclosure        | Convex US-hosted is acknowledged; SCC mechanism in privacy policy; sensitive PII at vendor | [`README.md`](README.md) trust boundaries                                       |
| LGPD erasure across entities        | `eraseUserData` workflow across `Mutav-BR` and `Mutav-Fund` domains                        | This doc + [`reliability.md`](reliability.md)                                   |
| Offshore fund-admin segregation     | Separate custody (`Mutav-Fund`) and operational (`Mutav-Mgmt`) Soroban contracts           | [`onchain-integration.md`](onchain-integration.md) § Contract topology          |
| Reproducible NAV per tranche        | Per-tranche NAV inputs in audit log; hash-chained log                                      | [`reliability.md`](reliability.md), [`tranches.md`](tranches.md)                |
| Three-axis reconciliation           | BR ledger ↔ fees; BR outflow ↔ Fund inflow; Fund position ↔ on-chain TESOURO               | [`reliability.md`](reliability.md) § Three-axis reconciliation                  |
| BCB KYC floor (counterparties)      | KYC-gated for deposit & redeem; counterparties hold BCB authorization                      | [`investor.md`](investor.md)                                                    |
| Regulatory pause (per entity)       | Circuit breaker primitive scopes per entity                                                | [`reliability.md`](reliability.md), [`compliance.md`](compliance.md)            |
| BCB câmbio reporting                | Correlation id on every BR ↔ offshore transfer; câmbio records extractable from audit log  | This doc § BACEN câmbio; [`reliability.md`](reliability.md)                     |
| KYC vendor abstraction              | Interface in `convex/compliance/providers/`, vendor adapters per file                      | [`investor.md`](investor.md), [`compliance.md`](compliance.md)                  |
| Audit integrity (entity-tagged)     | Hash chain + daily Merkle anchor; entries tagged with originating entity                   | [`reliability.md`](reliability.md)                                              |
| Per-entity multisig governance      | Per-entity signer sets; cross-entity multisig for cross-entity operations                  | [`admin.md`](admin.md) § A3, [`onchain-integration.md`](onchain-integration.md) |
| Cessão substance defense            | Audit-detail preserved per cessão event; investor classification gates marketing           | This doc § Cessão de recebíveis                                                 |
| CVM marketing classification gating | BR investor class enforces tranche access and Subscription Agreement availability          | [`compliance.md`](compliance.md), [`investor.md`](investor.md)                  |

## Out of scope

- Legal opinions on per-entity license stack — those go to external counsel via the [`../open-questions.md`](../open-questions.md) L-series. This doc reflects the working hypothesis, not opinions.
- Privacy policy and ToS text — operational, written from these architectural commitments (and explicitly covering the cross-entity data flow per [`entities.md`](entities.md))
- Vendor selection (KYC provider, multisig tool, audit firm) — these are decisions with selection criteria stated here, made by humans, not by architecture
- Tax reporting (DARF, IRRF, offshore filings) — operational
- COAF integration specifics — vendor-mediated
- LGPD ANPD registration / DPO appointment — operational, required, not architectural
- Offshore jurisdiction choice — open per L5; this doc references the chosen jurisdiction once decided

## Related reading

- [`entities.md`](entities.md) — the three entities and how they relate
- [`tranches.md`](tranches.md) — MTVH / MTVM / MTVL specification
- [`README.md`](README.md) — actor catalog, trust boundaries
- [`reliability.md`](reliability.md) — the primitives that satisfy regulatory expectations
- [`admin.md`](admin.md) — Mutav-staff role model (entity-scoped), audit log, multisig flow
- [`investor.md`](investor.md) — KYC boundary, wallet-as-identity, per-chain model, Subscription Agreement to `Mutav-Fund`
- [`onchain-integration.md`](onchain-integration.md) — contract topology, reconciliation, offshore custody
- [`compliance.md`](compliance.md) — capability matrix with tranche dimension, regulatory pause scoping
- [`../open-questions.md`](../open-questions.md) — L1a/b/c, L4a/b/c/d, L5, L6, L7, L8 — the questions counsel must answer
- [BCB Resolução 519/2025](https://www.bcb.gov.br/) — primary source
- [CVM Resolução 175](https://conteudo.cvm.gov.br/legislacao/resolucoes/resol175.html) — primary source
- [LGPD (Lei 13.709/2018)](http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709.htm) — primary source
- [CVM 2026 regulatory agenda](https://www.gov.br/cvm/pt-br/assuntos/noticias/2025/nova-regra-de-crowdfunding-de-investimento-ajustes-em-anexos-da-resolucao-175-e-projeto-135-light-integram-agenda-regulatoria-2026-da-cvm)
