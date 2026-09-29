# Transparency metrics — definitions

Every figure on the agency `/transparency` page (and the shared reserve / capacity
panels the admin `/treasury` screen reuses), with its formula, source and refresh
cadence. The code is the source of truth; this page must change in the same PR as
any formula below.

- **Guarantee figures** are computed by `convex/transparency/useCases.ts`
  (`getGuaranteeAggregates`) from the Convex guarantee book.
- **Reserve and capacity figures** are computed by `convex/reserve/domain.ts`
  (`deriveSolvencyFigures`) from the latest `reserveSnapshots` row, served by
  `getReserveCoverage`.

## Two sources, two units

| Source                                   | Unit                                               | Refresh                                                                                                                  |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Convex guarantee book (aggregates)       | **BRL** (centavos, shown as R$)                    | Real time. Convex aggregates update in the same transaction as every guarantee write; the page subscribes live.          |
| mutav-pulse reserve contracts on Stellar | **Vault asset units** (cUSD on testnet), never BRL | Every **15 minutes** (`refresh reserve snapshot` cron in `convex/crons.ts`). The page shows the snapshot's "as of" time. |

The two are **not** converted into each other on the page. The testnet reserve
settles in **cUSD**, a mock testnet asset, and there is no BRL price for a mock.
Mixing the units into one ratio would publish a number neither side can verify.

**Conversion caveat.** The reserve card shows one BRL line, marked _indicative
only_: the vault's total assets valued at the Banco Central do Brasil **PTAX
(venda/ask)** USD→BRL rate, fetched from the BCB OData service at snapshot time,
treating cUSD as USD-pegged (it is configured in `STELLAR_RESERVE_USD_SYMBOLS`).
No FX rate is invented: if PTAX cannot be fetched, no snapshot is written and the
page keeps the last good one. The PTAX line is context, not a coverage figure —
none of the ratios below use it.

**Testnet caveat.** On testnet the on-chain guarantee book (the mutav-pulse
registry) and the Convex guarantee book are independent: the contracts hold the
guarantees their own demo flows signed. The reserve-side ratios describe the
on-chain book the reserve actually backs; the BRL cards describe the Convex book.
Every reserve panel carries a **Testnet** badge while `STELLAR_NETWORK` is not
`public`.

## Guarantee figures (BRL / counts)

"In force" = the five insured states: `active`, `in_arrears`, `default_verified`,
`cover_committed`, `in_eviction` (`INSURED_STATES`, `convex/guarantees/domain.ts`).

"Exposure" of one guarantee = `capacity.availableCents + terms.exitCostCapCents`
— the remaining rent-coverage capacity plus the exit-cost sublimit, both from the
guarantee's own snapshot (`insuredCentsPlatform` aggregate,
`convex/guarantees/aggregate.ts`).

| Figure                            | Formula                                                        | Notes                                                                                                                                                                                                               |
| --------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guarantees in force               | count of guarantees in the in-force states                     |                                                                                                                                                                                                                     |
| Drafts                            | count of `drafted` guarantees                                  |                                                                                                                                                                                                                     |
| Default rate                      | (`default_verified` + `cover_committed`) ÷ guarantees in force | A count ratio, point-in-time. Null (shown "—") with nothing in force. `in_arrears` is excluded: it is the agency's unverified claim. `in_eviction` is excluded: its cover was already counted in `cover_committed`. |
| Total guaranteed (R$)             | Σ exposure over guarantees in force                            | Worst case — what Mutav would owe if every guarantee in force drew its full remaining cover plus exit cost.                                                                                                         |
| Exposure in verified default (R$) | Σ exposure over `default_verified` + `cover_committed`         | Same numerator states as the default rate, so the two figures describe the same set of guarantees. Subset of Total guaranteed.                                                                                      |

## Reserve figures (vault asset units)

Read over Soroban RPC by transaction **simulation** — read only; nothing is signed
or submitted, and no signing key is involved. Contracts (testnet defaults, each
overridable by env):

| Contract | Env var                                | Testnet default                                            | Read                                                                                                                  |
| -------- | -------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| vault    | `STELLAR_RESERVE_CONTRACT_ID`          | `CA26WJGO5MINAT47DCGMU54HYW5A3RQ7VSE4ANPCYYA4TGXTJZQJ5EZQ` | `total_assets`, `stable_assets`, `free_capital`, `available_held`, `strategies`, `query_asset`                        |
| policy   | `STELLAR_RESERVE_POLICY_CONTRACT_ID`   | `CBC2IJHH3FQMIQETFYDIEQG7OFJXTRKKLJDDONQ6N47AB3HLWWEIZQVO` | `coverage_required`; the ratio `c` from instance storage key `CoverageRatioBps` (the policy exposes no getter for it) |
| registry | `STELLAR_RESERVE_REGISTRY_CONTRACT_ID` | `CDJYJLUJL55SFD5YPSEKH6IZN3XRPLOCSFG33LDXOHEI2JY2ILITUSZ4` | `raw_coverage`                                                                                                        |

Each strategy's `balance()` and the underlying token's `symbol()` / `decimals()`
are read too. On `STELLAR_NETWORK=public` there are no defaults: the reserve reads
`unavailable` until all three ids are set. Raw i128 values are stored verbatim in
the snapshot (audit trail) and scaled by the token's decimals at query time.

The protocol invariant these figures expose is enforced on-chain by the contracts
(mutav-pulse `docs/concepts/solvency-and-coverage.md`):
`stable_assets ≥ coverage_required`.

| Figure                      | Formula                                                        | Notes                                                                                                                                                                                                                  |
| --------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage reserve            | vault `total_assets` = idle balance + every strategy's balance |                                                                                                                                                                                                                        |
| Coverage required           | policy `coverage_required` = ceil(`raw_coverage` × c)          | `raw_coverage` = Σ remaining default + exit legs of every active on-chain guarantee (registry aggregate).                                                                                                              |
| Coverage ratio              | `stable_assets` ÷ `coverage_required`                          | How many times the on-chain book is backed by stable capital. ≥ 1× is the solvency invariant. Null (shown "No coverage reserved") when `coverage_required` = 0. Volatile strategies are excluded from `stable_assets`. |
| Required coverage ratio (c) | policy `CoverageRatioBps` ÷ 10 000                             | The policy knob. c = 1 is hard-solvent (no leverage); c > 1 over-collateralizes.                                                                                                                                       |
| Reserve breakdown — balance | `available_held` for the idle row; `balance()` per strategy    | One row per position: idle in the vault, then each strategy, with its stable/volatile flag.                                                                                                                            |
| Reserve breakdown — share   | position balance ÷ `total_assets`                              | Null on an empty vault.                                                                                                                                                                                                |
| Contract ids                | the ids the snapshot was read from                             | Rendered as text with a Stellar Expert link — taken from the snapshot, not current env, so they always match the figures.                                                                                              |

## Capacity figures (vault asset units)

Capacity follows mutav-pulse's rule, **"capacity is solvency"**: there is no
configured cap (this replaces the former `MAX_GUARANTEE_CAPACITY_CENTS` env
constant). The book can grow exactly as far as on-chain stable capital backs it —
`sign_guarantee` reverts on-chain if it would push `coverage_required` above
`stable_assets`.

| Figure             | Formula                                                              | Notes                                                                                                                                                      |
| ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remaining capacity | vault `free_capital` = max(0, `stable_assets` − `coverage_required`) | The surplus above the floor: what can still be reserved for new guarantees (or redeemed by investors).                                                     |
| Capacity ceiling   | `stable_assets` ÷ c                                                  | The largest raw on-chain book the current stable capital can back. Null ("Unbounded") when c = 0. At c = 1, ceiling − `raw_coverage` = remaining capacity. |
| Utilization        | `coverage_required` ÷ `stable_assets`                                | Share of stable capital already reserved. Null on an empty vault; the bar clamps at 100 %.                                                                 |

## Availability

The reserve / capacity panels show **Unavailable** rather than a number when no
snapshot exists yet, or the latest snapshot has no priced value. A failed read
(RPC error, unexpected contract shape, missing `CoverageRatioBps`, PTAX outage)
writes nothing, so the page keeps the last good snapshot and its timestamp —
never a mock or a zero.

## Admin `/treasury` — staff-only figures

The admin treasury screen renders the same reserve, capacity and breakdown
panels from the same queries (`getReserveCoverage`, `getGuaranteeAggregates`),
plus these derived figures. Code: `apps/admin/src/components/treasury/view-model.ts`.

| Figure                    | Formula                                                                                                  | Notes                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solvency status           | `solvent` if coverage ratio ≥ 1, `undercovered` if < 1, `noBook` if nothing reserved, else `unavailable` | The contracts enforce the floor only when money moves; a strategy loss or depeg can breach it between moves, which is what `undercovered` surfaces.  |
| Stale snapshot            | now − `capturedAt` > 45 min                                                                              | Three missed 15-minute cron ticks. A failed read writes nothing, so age is how a broken read shows. Computed client-side only (no SSR clock).        |
| Book capacity — ceiling   | `stable_assets` ÷ c                                                                                      | Same as the capacity ceiling above.                                                                                                                  |
| Book capacity — used      | registry `raw_coverage`                                                                                  | The raw book the vault backs today, in the same units as the ceiling.                                                                                |
| Book capacity — remaining | max(0, ceiling − used)                                                                                   | = `free_capital` ÷ c up to the policy's ceil rounding. Staff see ceiling − used = remaining on one scale, unlike the collateral-unit headline above. |
| Cover committed           | count of guarantees in `cover_committed`                                                                 | From the guarantee state aggregate; the cover-operations ledger (recorded vs executed) is not shown yet.                                             |
