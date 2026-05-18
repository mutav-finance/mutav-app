# Regulatory Architecture — Brazil

> Mutav operates in Brazil and serves Brazilian retail and institutional investors. This document defines the regulatory floor the architecture must support — LGPD for data, CVM for fund operations, BCB for payments — and the architectural choices that follow from each. It is not a legal compliance plan; it is the set of architecture constraints that fall out of Brazilian regulatory reality. Operational compliance (filings, vendor contracts, opinions) is out of scope.

The regulatory landscape as of 2026 is the most concrete it has been: BCB Resolução 519/2025 is in force, CVM Resolução 175 governs tokenized fund structures, and CVM's 2026 agenda explicitly includes tokenization rules. Architecture decisions made now should anticipate scrutiny within 12–24 months.

## LGPD — data protection

Brazil's general data protection law (Lei Geral de Proteção de Dados) sets the floor for handling personal data.

### Architectural constraints

1. **Cross-border data transfer is allowed with disclosure.** Convex is hosted in the US (AWS). LGPD does not strictly require BR residency for personal data, but cross-border transfer requires (a) a documented legal basis — typically Standard Contractual Clauses (SCCs), (b) disclosure in the privacy policy, (c) data subject notification on first use.
2. **Sensitive PII stays at the source where possible.** Biometric KYC payloads, full ID document images, raw face-match scores never leave the KYC vendor's infrastructure. Convex stores only `kycStatus` (status enum) and `kycRef` (vendor's verification id). The vendor is the data processor; Mutav is the data controller for the relationship; the vendor's KYC archive is queried on demand via API for audit purposes, not bulk-replicated.
3. **Right to erasure (Art. 18, IX).** Investors and agency staff have the right to request deletion of personal data. The architecture must support a `eraseUserData` action that scrubs PII fields across all domains where they appear, retaining only the minimum required for regulatory record-keeping (audit log entries with hashed-anonymized actor refs, financial transaction history with a tombstone for the user). Erasure is a workflow (see [`reliability.md`](reliability.md)) — it touches multiple domains; partial failure must be detectable and resumable.
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

Out of scope architecturally but operationally required: a documented privacy policy declaring the cross-border transfer to Convex, the KYC vendor processor relationship, the data retention schedule, and the erasure procedure. These are legal artifacts; the architecture must enable them.

## CVM Resolução 175 — fund operations

CVM 175 (effective 2023, ongoing amendments) consolidates Brazilian fund regulation. If Mutav SA is structured as a regulated investment fund (likely a FIDC — Fundo de Investimento em Direitos Creditórios — given it backs rental-guarantee credits), CVM 175 applies. CVM's 2026 agenda explicitly addresses tokenized fund structures, so architectural choices made now should anticipate the rules.

### Architectural constraints

1. **Segregated account topology is a regulatory expectation, not just a software pattern.** CVM-regulated funds maintain strict separation between fund assets and the administrator's operational assets. Software-wise this means: separate Soroban contracts for fund custody (Mutav SA) and operational logic (mint authority, NAV updater, liquidation executor), with the operational contracts having narrow approval-gated access to custody. This matches the ERC-4626 vault pattern on EVM and is the topology Centrifuge, Maple v2, Goldfinch, and Ondo all use.
2. **NAV calculation must be reproducible by an external auditor.** The audit log captures NAV update inputs (active layer value, liquidity layer value, outstanding shares), not just outputs. An auditor with read access to the historical audit log can reconstruct every NAV update. See [`reliability.md`](reliability.md) § NAV safety.
3. **Reconciliation between offchain accounting and onchain state is required.** Mutav SA's books and the onchain fund supply must match at every snapshot. Discrepancies pause the fund. See [`reliability.md`](reliability.md) § Reconciliation.
4. **Investor records are retained.** CVM requires fund administrators to retain investor records for 5 years after the relationship ends. Erasure (LGPD Art. 18) is constrained — the erasure procedure preserves the minimum CVM-required record (transaction history, KYC verification proof) with PII anonymized.
5. **Reporting surface.** CVM-regulated funds file periodic reports (monthly performance, quarterly composition, annual audits). The architecture must support extracting these from the audit log + financial state without ad-hoc data archaeology. `@convex-dev/aggregate` is the right primitive for materialized financial totals.

### Tokenization-specific anticipation

CVM's 2026 agenda flags tokenized fund rules as a workstream. Anticipated requirements (based on current draft posture and global precedent):

- **Token transferability restrictions** — tokens may be restricted to verified-KYC wallets only. Architecture must support a transfer-allowed-list at the contract level.
- **Disclosure obligations** — investor-facing UI must surface fund risk classification, fee schedule, NAV history, liquidity terms in a CVM-prescribed format.
- **Investor classification** — retail vs qualified investor classification gates which products an investor can access. Architecture must support classification status on the investor profile.

These are not v1 requirements but should not be designed-out.

## BCB Resolução 519/2025 — KYC and VASP authorization

BCB 519/2025 (in force 2025) consolidated Brazilian crypto regulation. The KYC floor it sets is non-negotiable for any consumer-facing crypto service operating in Brazil.

### Architectural constraints

1. **No anonymous interaction with funds.** Every investor must be CPF-identified (PF) or CNPJ-identified (PJ) before any deposit. The investor portal architecture in [`investor.md`](investor.md) reflects this — wallet-as-identity for read; KYC-gated for deposit and redeem; "deposit without KYC" is not a valid v1 path even though it's technically possible with wallet-as-identity.
2. **Operating without BCB authorization triggers payment cutoff.** BCB has the power to block IP ranges and disconnect non-compliant VASPs from the payment system. The architecture must support a "regulatory pause" — admin action that halts all deposit/redeem flows while preserving fund state. This is the same circuit-breaker primitive used for reconciliation mismatches (see [`reliability.md`](reliability.md) § Reconciliation).
3. **CPF as canonical user identifier.** Once KYC is complete, the CPF (or CNPJ) becomes the canonical identifier for that investor profile. Multiple wallets across chains can be linked to the same CPF — but per the wallet-as-identity-per-chain model in [`investor.md`](investor.md), this linking is documented (so the architecture can support per-CPF aggregation for tax reporting) but doesn't unify identity across chains for operational purposes.
4. **Source-of-funds checks.** BCB 519/2025 requires VASPs to track source of funds. Architecture: every deposit's `correlationId` (see [`reliability.md`](reliability.md) § Reconciliation) chains back to a bank-confirmed BRL deposit. The chain of custody from Brazilian bank account → Pix → Etherfuse → onchain mint is documented at every step.

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
- Multiple vendors can be active simultaneously (Sumsub for L4/L5 institutional; a BR-native for L1/L2 if Mutav adds retail surface)

This matches the pattern already in place for anchors (`src/lib/anchors/registry.ts` + per-provider clients).

## Settlement provider selection (agency → Mutav)

Distinct from KYC vendor selection above and from anchor selection (Etherfuse for investor on-ramp). The settlement provider handles **agency → Mutav** monthly B2B flows: agencies pay Mutav fees in BRL via Pix; the provider converts to stablecoin and delivers to a Mutav treasury address on the destination chain. Pattern documented in [`onchain-integration.md`](onchain-integration.md) § Agency settlement (BaaS providers).

### Required architectural properties

- **BCB Payment Institution authorization** (existing IP license per Resolution 4.282/2013, OR will hold under the new IP regime per Resolutions 494/495/496/497 with May 2026 authorization window). Unauthorized providers cannot legally handle BRL float for Mutav after the October 30, 2026 cliff.
- **VASP authorization under BCB Resolutions 519/520/521** (Nov 2025). Mutav cannot transact with non-authorized VASPs after the cliff; the transition window is 270 days from Feb 2026.
- **API + webhook reliability** — REST API for the three-call orchestration (Pay-In, Trade, Crypto-Out); webhooks for each lifecycle event with correlation ids preserved end-to-end. The correlation id is mandatory; without it, reconciliation per [`reliability.md`](reliability.md) § Reconciliation is not possible.
- **Destination chain coverage** — Stellar v1, generalizable to additional chains as Mutav expands. Native USDC delivery preferred; BRZ-as-intermediate acceptable if BRZ → USDC Trade is reliable.
- **Travel Rule compliance** (mandatory domestic per Resolution 520). Provider collects originator/beneficiary data on transfers.
- **MED 2.0 readiness** — provider notifies promptly on MED reversals via webhook; Mutav's quarantine pattern depends on it.

### Shortlist (Brazilian B2B Pix-to-crypto, 2026)

| Provider                  | Status                                                                                | Notes                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transfero BaaSiC**      | BCB Payment Institution (Sept 2023). VASP re-application pending under new framework. | Issues BRZ (multichain stablecoin incl. Stellar). 13M+ tx in 2023. Three-call orchestration (Pay-In → Trade → Crypto-Out). Stellar-native USDC in one hop is **not publicly documented** — confirm in sandbox. Pricing opaque (gated by sales). Customers include Bitget, BRX Finance, Stakease, Kona Finance. |
| **Bitso Business**        | Mexico-HQ, established BR operations.                                                 | Single-API BRL → USDC with "just-in-time" settlement. Processed $6.5B in US-MX remittances 2024 (mature reconciliation story). Strongest direct competitor to Transfero for this use case. Webhook + correlation-id story likely cleaner than Transfero's.                                                     |
| **Foxbit Prime Desk**     | BR-native, member of BRL1 consortium.                                                 | "Invisible stablecoin" B2B FX product. REST OTC API. Quote-driven pricing. Good fit if volume is large enough to negotiate.                                                                                                                                                                                    |
| **Etherfuse (extension)** | Currently Mutav's user-facing on-ramp.                                                | SEP-24 is interactive/user-driven by spec; SEP-6 could in principle drive system-initiated deposits. Not their primary B2B pitch, but extending the existing relationship to system-driven B2B is worth a conversation before adopting a second vendor.                                                        |

**Out of consideration:**

- **Stripe + EBANX Pix** — fiat acquiring only; stablecoin balances are US-issued, not delivered onchain to arbitrary addresses. Wrong tool.
- **Mercado Bitcoin OTC** — quote-driven OTC, not a productized B2B settlement rail with webhooks.
- **BRL1 consortium** — the stablecoin itself, not a settlement product; rails are the member exchanges (Bitso, Foxbit).

### Settlement provider abstraction

Same pattern as KYC and anchor abstractions:

- `convex/settlement/providers/{transfero,bitso,foxbit,etherfuse}.ts` implement a stable interface (`createPayIn`, `getQuote`, `executeTrade`, `deliverCrypto`, `getStatus`, `handleReversal`)
- Vendor selection is a configuration choice per agency, per fund, or per settlement type
- Multiple vendors can coexist (Bitso for high-volume agencies, Transfero for those already integrated elsewhere)

### Critical due-diligence checklist before signing any provider

1. **Authorization status under both Nov 2025 VASP framework and May 2026 IP framework** — confirm provider is on track for both. Mutav cannot transact post-cliff (Oct 30, 2026) with non-authorized providers.
2. **Webhook event catalog including crypto-out / on-chain delivery events** — confirm correlation id propagates end-to-end. If only Pay-In gets a webhook and crypto-delivery requires polling, that's a reconciliation tax.
3. **MED reversal notification SLA** — how fast does the provider notify; what's the format. Mutav's quarantine clock depends on this signal.
4. **Travel Rule data handling** — confirm provider collects and stores; confirm what Mutav receives and must store independently.
5. **LGPD DPA with ANPD SCCs** — same expectation as KYC vendor selection above.
6. **Pricing model** — spread on Trade, per-tx fees, monthly minimums. Volume projections inform shortlist ranking.
7. **Stablecoin delivery options** — native USDC on Stellar (one-hop preferred); BRZ → USDC routing if not.
8. **Slippage controls on Trade endpoint** — confirm a max-slippage parameter exists and rejected trades roll back cleanly.

## Audit trail expectations

The hash-chained, Merkle-anchored audit log defined in [`reliability.md`](reliability.md) § Audit log integrity satisfies CVM and BCB expectations for forensic defensibility. The architectural commitment is:

- Every state-affecting Mutav-internal action produces an audit entry (enforced by the `mutationWithMutavStaff` wrapper)
- Entries are hash-chained — any tampering invalidates the chain forward of the tampered entry
- Daily Merkle roots are anchored on Stellar — external auditors verify by re-deriving and comparing
- The audit log is queryable by actor, target, time range — supports both regulator inquiries and internal investigations
- Retention is open-ended for audit entries (small footprint per entry); investor PII referenced by entries is anonymized when the related investor's data is erased

The 5-year CVM retention requirement for investor records is met by the audit log + transaction history; PII fields are anonymized on LGPD erasure, but the financial events themselves remain.

## Multisig governance

Treasury operations (NAV updates, liquidations, contract upgrades, signer set changes) require multisig consensus per [`onchain-integration.md`](onchain-integration.md) § Write architecture. The architectural constraints from a regulatory perspective:

1. **Signer set is documented externally.** Who can sign treasury operations is a legal/governance question, not an app configuration. The set is maintained in legal documentation (Mutav SA operating agreement); the onchain signer addresses are derived from that documentation. Changes to the signer set are themselves multisig operations that produce audit entries.
2. **No single signer can move funds.** The threshold is set such that a compromise of one signer cannot drain the fund. Standard: 3-of-5 weighted with geographic / role diversity in the signer set.
3. **Key ceremony is documented.** Initial signer key generation, rotation procedures, recovery procedures are operational artifacts but the architecture must support them — every signer change is an admin operation producing audit entries.

### Stellar implementation pattern (hybrid leaning native-first)

Stellar's native multisig (classic G-account with weight-based m-of-n: signer weights 1–255, three operation thresholds Low/Med/High, up to 20 signers) is **the production primitive in 2026** and what major protocols (Aquarius Signers Guild, Blend, FxDAO) actually run for treasury. Soroban smart accounts (CAP-46-5 custom-account interface) and the OpenZeppelin Stellar Smart Accounts crate are the new modern primitive — production-ready, audited via the SDF×OpenZeppelin partnership through Dec 2026 — but they coexist with native multisig rather than replace it.

**Recommendation for Mutav treasury:**

- **Treasury account: classic G-account with native multisig** (3-of-5 weighted, per § Multisig governance above). Battle-tested, every Stellar wallet understands it, audit trail at the protocol level, zero contract risk. Soroban contracts (NAV updater, liquidation executor) accept this G-account as the admin/owner — multisig auth on classic accounts propagates into Soroban via standard `require_auth`. No custom smart-account contract needed for treasury ops.
- **Signer wallet: Lobstr Vault** for each ops staff member. Mobile-first, push notifications per pending transaction, biometric approval. The closest thing to a Squads/Safe signer experience on Stellar. Add Freighter as a desktop backup signer for each role.
- **Proposal/queue UI: built inside Mutav's `(admin)` shell** (~1–2 weeks of work). A `treasury/proposals` route that constructs the XDR, persists pending transactions in Convex with collected signatures, exposes a "Sign on Lobstr" deep link per signer, and submits the transaction once threshold is met. This is the Safe-equivalent that doesn't yet exist on Stellar. Details in [`admin.md`](admin.md) § A3/A6.

**Defer Soroban smart accounts (OpenZeppelin / kalepail's `smart-account-kit`) to v2** — they're the right primitive for **investor-facing** passkey onboarding (where Meridian Pay has shipped 1k+ users), but for treasury the surface area of an unaudited custom-account contract isn't worth the UX gain over native multisig + Lobstr.

**Not recommended for treasury:**

- `kalepail/passkey-kit` (now legacy/demo, unaudited)
- StellarGuard (co-signer-as-a-service, not a multi-party proposal queue)
- `multisigstellar/multisig` (lightweight coordinator, not a full queue — useful as reference for the Mutav-built UI)
- SEP-30 (RecoverySigner is for user account recovery, not treasury control plane — different problem)

**2026 changes worth re-checking before build:** Protocol 26 (CAP-77 Quorum Freeze, CAP-82 256-bit math), OpenZeppelin Stellar Smart Accounts audit completion timeline, Lobstr full Soroban transaction parsing release.

## Architectural decisions that follow from this doc

Summary of constraints the regulatory floor imposes on architecture:

| Constraint                   | Architectural commitment                                                                   | Where it lives                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| LGPD cross-border disclosure | Convex US-hosted is acknowledged; SCC mechanism in privacy policy; sensitive PII at vendor | [`README.md`](README.md) trust boundaries                                               |
| LGPD erasure                 | `eraseUserData` workflow across domains                                                    | This doc + [`reliability.md`](reliability.md)                                           |
| CVM segregated account       | Separate custody and operational Soroban contracts                                         | [`onchain-integration.md`](onchain-integration.md) § Contract topology                  |
| CVM reproducibility          | NAV inputs in audit log; hash-chained log                                                  | [`reliability.md`](reliability.md)                                                      |
| CVM reconciliation           | Anchor↔chain reconciliation primitive                                                      | [`reliability.md`](reliability.md) + [`onchain-integration.md`](onchain-integration.md) |
| BCB KYC floor                | Wallet-as-identity for read; KYC-gated for deposit & redeem                                | [`investor.md`](investor.md)                                                            |
| BCB regulatory pause         | Circuit breaker primitive                                                                  | [`reliability.md`](reliability.md)                                                      |
| BCB source-of-funds          | Correlation id from bank → Pix → mint                                                      | [`reliability.md`](reliability.md) + [`onchain-integration.md`](onchain-integration.md) |
| KYC vendor abstraction       | Interface in `convex/kyc/`, vendor adapters in `providers/`                                | [`investor.md`](investor.md) when scoped                                                |
| Audit integrity              | Hash chain + daily Merkle anchor                                                           | [`reliability.md`](reliability.md)                                                      |
| Multisig governance          | Externally-documented signer set; admin UI for proposals                                   | [`admin.md`](admin.md)                                                                  |

## Out of scope

- Legal opinions on whether Mutav SA must register as a FIDC, payment institution, or VASP — that's outside legal counsel's territory and outside this doc
- Privacy policy and ToS text — operational, written from these architectural commitments
- Vendor selection (KYC provider, multisig tool, audit firm) — these are decisions with selection criteria stated here, made by humans, not by architecture
- Tax reporting (DARF, IRRF) — operational
- COAF integration specifics — vendor-mediated
- LGPD ANPD registration / DPO appointment — operational, required, not architectural

## Related reading

- [`README.md`](README.md) — actor catalog, trust boundaries
- [`reliability.md`](reliability.md) — the primitives that satisfy regulatory expectations
- [`admin.md`](admin.md) — Mutav-staff role model, audit log, multisig flow
- [`investor.md`](investor.md) — KYC boundary, wallet-as-identity, per-chain model
- [`onchain-integration.md`](onchain-integration.md) — contract topology, reconciliation
- [BCB Resolução 519/2025](https://www.bcb.gov.br/) — primary source
- [CVM Resolução 175](https://conteudo.cvm.gov.br/legislacao/resolucoes/resol175.html) — primary source
- [LGPD (Lei 13.709/2018)](http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/L13709.htm) — primary source
- [CVM 2026 regulatory agenda](https://www.gov.br/cvm/pt-br/assuntos/noticias/2025/nova-regra-de-crowdfunding-de-investimento-ajustes-em-anexos-da-resolucao-175-e-projeto-135-light-integram-agenda-regulatoria-2026-da-cvm)
- SEC Rule 17a-4(f) (2022 amendment) — international precedent for hash-chained audit trails
