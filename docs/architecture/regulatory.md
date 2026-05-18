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
- **BR data residency option**

Candidate vendors (verified against 2026 market): **Unico** (dominant biometric, market-leading liveness), **Caf** (fintech-friendly, customizable risk rules), **Datavalid** (SERPRO; source-of-truth for CPF/CNPJ — typically used alongside a biometric provider), **Didit** (newer, COAF-compliant, lighter integration). Common pattern: biometric vendor + Datavalid (or equivalent), not one vendor for both.

### KYC vendor abstraction

To avoid hard-coupling the architecture to a single vendor:

- The `kyc` Convex domain exposes a stable interface (`startVerification`, `getStatus`, `getRef`, `revoke`) that the rest of the system calls
- Vendor-specific clients live in `convex/kyc/providers/{unico,caf,didit}.ts` and implement the interface
- Vendor selection is a configuration choice, not a code change
- Multiple vendors can be active simultaneously (failover, or different vendors for different investor classes)

This matches the pattern already in place for anchors (`src/lib/anchors/registry.ts` + per-provider clients).

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
2. **No single signer can move funds.** The threshold is set such that a compromise of one signer cannot drain the fund. Standard: 3-of-5 or 2-of-3 with geographic / role diversity in the signer set.
3. **Key ceremony is documented.** Initial signer key generation, rotation procedures, recovery procedures are operational artifacts but the architecture must support them — every signer change is an admin operation producing audit entries.
4. **Multisig tool UX gap on Stellar.** Stellar's native multisig (weight-based m-of-n via signer weights + operation thresholds) is powerful but lacks a Safe / Squads-equivalent ops UI. Mutav will likely need to build the proposal-queue UX in the `(admin)` shell, since third-party Stellar multisig UIs are immature. This is documented in [`admin.md`](admin.md) A3/A4 future-pillar sketches.

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
