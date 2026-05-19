# Entities

> Mutav is not one legal entity. The consumer brand "Mutav" is the public face of a composite of three legal entities across two jurisdictions, each with its own regulator, books, and capability set. Every architecture doc that names "Mutav" in a financial / regulatory / operational sense must resolve to one of the three entity codes defined here. This file is the canonical registry — every other doc references it.

## Naming convention — the rule

**Bare "Mutav" is the consumer brand only.** Use it in user-facing UI copy, marketing, and informal references to "the platform". Anywhere a doc needs to name _who does the thing_ — receives money, holds an asset, runs a workflow, signs a transaction, appears in an audit log entry, is the counterparty to a contract — use one of the three entity codes below. Bare "Mutav" in an architectural sentence is a bug; treat as a review block.

Final legal names land with PR [mutav#32](https://github.com/mutav-finance/mutav/pull/32). Until then this doc uses the placeholder codes and so does every doc that references it. Substitution will be a single find-replace pass.

## Entity registry

| Code             | Legal entity (placeholder)  | Domicile               | Function                                                                                                                            | Audit-log entity code |
| ---------------- | --------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **`Mutav-BR`**   | Mutav Garantidora (BR)      | Brazil                 | Fiança under Lei do Inquilinato Art. 37. Consumer-facing brand. Receives agency fees; routes 80% via cessão to `Mutav-Fund`.        | `MUTAV_BR`            |
| **`Mutav-Fund`** | Mutav Fund (offshore)       | Offshore (TBD, see L5) | Holds TESOURO (Etherfuse tokenized BR Treasury). Issues three tranches `MTVH` / `MTVM` / `MTVL` — see [`tranches.md`](tranches.md). | `MUTAV_FUND`          |
| **`Mutav-Mgmt`** | Mutav Management (offshore) | Offshore (TBD, see L5) | Administers `Mutav-Fund`: NAV updates, liquidation execution, treasury signing operations. Charges management + withdrawal fees.    | `MUTAV_MGMT`          |

The three entities have shared founding ownership and share the "Mutav" brand, but are distinct legal vehicles with distinct books, regulators, and accountability surfaces.

## Money + value flow

```
                  consumer brand: "Mutav"
                        │
       ┌────────────────┼────────────────┐
       │                │                │
   Mutav-BR        Mutav-Fund        Mutav-Mgmt
   (BR)            (offshore)        (offshore)
        │                ▲                │
        │                │                │
        │   80% cessão   │   admin fees   │
        └────────────────┤◄───────────────┘
                         │
                         ▼
                 holds TESOURO (Etherfuse, Stellar)
                 issues MTVH / MTVM / MTVL
                         ▲
                         │ Subscription Agreement
                         │ + KYC
                         │
                     investors


Tenant → Imobiliária collects fee → Mutav-BR receives → 20% retained
                                                      → 80% cessão to Mutav-Fund
                                                          → mint TESOURO (Etherfuse) into Fund's Stellar address
                                                          → Mutav-Mgmt records position, updates NAV
```

Default coverage runs the reverse direction:

```
Default detected → Mutav-BR notifies → Mutav-Mgmt instructs Mutav-Fund to liquidate
                                                                 │
                                       ┌─────────────────────────┘
                                       ▼
                                Mutav-Fund redeems TESOURO (Etherfuse, BRL out)
                                       │
                                       ▼
                                BRL routed back to Mutav-BR for payout to imobiliária / proprietário
                                       │
                                       ▼
                                NAV waterfall: MTVH absorbs first → MTVM → MTVL
                                       (see tranches.md for full waterfall)
```

## Per-entity detail

### `Mutav-BR` — Brazilian operator

- **Function.** Fiança institucional under Art. 37 inciso I da Lei 8.245/91 (Lei do Inquilinato). Consumer-facing brand: every imobiliária, inquilino, and external observer interacts with `Mutav-BR` as "Mutav".
- **Books.** BR accounting in BRL. Receives 100% of imobiliária fee transfers; recognizes 20% as own revenue, books 80% as cessão de recebíveis to `Mutav-Fund`.
- **Regulatory anchors.** Lei do Inquilinato (load-bearing legal basis), LGPD, ISS municipal on services, BCB câmbio reporting on transfers to offshore Fund.
- **License posture.** Working hypothesis: the fiança model keeps `Mutav-BR` outside SUSEP (not a seguradora) and CVM (not a fundo). Open question L1a — needs counsel confirmation; see [`../open-questions.md`](../open-questions.md).
- **Custody.** Holds BRL only. Never holds crypto or tokenized assets directly. The BRL → crypto leg is performed by Etherfuse on `Mutav-BR`'s behalf during the cessão settlement.
- **Audit-log code.** `MUTAV_BR`.

### `Mutav-Fund` — offshore fund

- **Function.** Holds the treasury (TESOURO via Etherfuse on Stellar). Issues three token tranches `MTVH` / `MTVM` / `MTVL` with a first-loss waterfall (see [`tranches.md`](tranches.md)). Absorbs default losses on instruction from `Mutav-Mgmt`.
- **Books.** Offshore accounting in chosen base currency (likely USD or fund-base — open per L4c). NAV per tranche updated periodically; recorded position reconciled against on-chain TESOURO balance per [`reliability.md`](reliability.md) § Reconciliation.
- **Regulatory anchors.** Determined by jurisdiction (Cayman CIMA / BVI FSC / Bermuda BMA / Marshall Islands / UAE ADGM / Próspera — open per L5). Each carries different fund-admin custody rules, reporting cadence, and investor-protection rules.
- **License posture.** Not BCB- or CVM-regulated as a _fund_ (CVM 175 is a BR construct). But the _offering_ of fund tokens to BR investors triggers CVM rules on oferta pública offshore (L6) and economic-substance scrutiny on the cessão (L8).
- **Custody.** Holds TESOURO via a Stellar address. Signing authority delegated to `Mutav-Mgmt` per offshore fund-admin custody norms (independent admin signing per Cayman / BVI / Bermuda standards).
- **Counterparty to investors.** The Subscription Agreement is between the investor and `Mutav-Fund` — not `Mutav-BR`.
- **Open dependency on Etherfuse.** Whether Etherfuse permits an offshore entity to hold TESOURO is the load-bearing question L3 / P3. If the answer is no, a fourth entity (`Mutav-BR-Treasury`) would hold TESOURO on behalf of `Mutav-Fund`. The rest of the architecture survives either way.
- **Audit-log code.** `MUTAV_FUND`.

### `Mutav-Mgmt` — offshore administrator

- **Function.** Administers `Mutav-Fund`: proposes NAV updates, executes liquidation instructions, signs treasury operations, files offshore regulatory reports, manages the redemption queue.
- **Books.** Records its own revenue from `Mutav-Fund` (management fee % of AUM + withdrawal fee % on resgates). Books distinct from `Mutav-Fund`'s books — administrator and fund are separate ledgers even though same physical ops team for v1.
- **Regulatory anchors.** Same offshore jurisdiction as `Mutav-Fund` (typically must co-locate per fund-admin rules). May need additional fund-admin registration (CIMA/FSC etc).
- **License posture.** Open per L1c. Same dependency on L5 jurisdiction.
- **Custody.** Holds signing keys for `Mutav-Fund`'s Stellar address. Multisig topology (Lobstr Vault on individual `Mutav-Mgmt` ops staff devices) per [`onchain-integration.md`](onchain-integration.md) § Offshore custody chain.
- **Audit-log code.** `MUTAV_MGMT`.

## Implications for the architecture

This section calls out concretely where the three-entity split changes the platform's shape. Detail in the linked sections.

- **Audit log carries entity code per entry.** Every write logs which entity initiated, so post-hoc reconciliation can split by entity. See [`reliability.md`](reliability.md) § Audit log integrity.
- **Reconciliation is three-axis, not one.** BR ledger ↔ collected fees; BR outflow ↔ Fund inflow; Fund recorded position ↔ on-chain TESOURO. See [`reliability.md`](reliability.md) § Three-axis reconciliation.
- **Mutav-internal staff sub-roles scope by entity.** A `treasury` sub-role serves `Mutav-Mgmt`. A `compliance` sub-role can span both `Mutav-BR` and `Mutav-Mgmt`. See [`admin.md`](admin.md) § A1–A6.
- **Capability matrix has a tranche dimension.** Which investor level (L0–L5) can hold MTVH vs MTVM vs MTVL. See [`compliance.md`](compliance.md) and [`tranches.md`](tranches.md).
- **Subscription Agreement is with `Mutav-Fund`** — not "Mutav". See [`investor.md`](investor.md).
- **Cross-entity workflows.** Deposit, default coverage, and resgate all cross entity boundaries. Each step logs the originating entity. See [`reliability.md`](reliability.md) § Cross-entity flows.

## Related reading

- [`../open-questions.md`](../open-questions.md) § L1 (license per entity), L3 (Etherfuse offshore), L5 (jurisdiction), L6 (CVM marketing), L7 (BACEN câmbio), L8 (cessão substance)
- [`regulatory.md`](regulatory.md) — the regulatory floor per entity
- [`tranches.md`](tranches.md) — MTVH / MTVM / MTVL specification
- [`reliability.md`](reliability.md) — entity-aware audit log + reconciliation
- [`admin.md`](admin.md) — pillar-to-entity mapping for Mutav-internal staff
