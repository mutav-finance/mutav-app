# ADR 0005 — Wallet-signing architecture: one kit, account-side multisig

**Status:** Accepted, **evolving** (2026-06-22) — the wallet integration is firm; the admin-authority _account model_ (native multisig vs contract account) and the vault standard alignment are under active investigation (see § Open). **Supersedes** the [#157](https://github.com/mutav-finance/mutav-app/pull/157) draft · resolves the "vetted, low-CVE replacement" deferred in `CLAUDE.md` when `@creit.tech/stellar-wallets-kit` was removed (9 CVEs via unused Trezor/HOT/NEAR adapters).

## Context

`mutav-app` has **three signing surfaces** plus one that signs nothing:

| Surface       | Who         | Signs                                                                                                                      | Posture                           |
| ------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `apps/admin`  | Mutav staff | reserve-vault `cover_default`, treasury, params (pilot §D / [#201](https://github.com/mutav-finance/mutav-app/issues/201)) | **M-of-N quorum**, cold           |
| `apps/fund`   | investors   | deposit / redeem; wallet-as-identity, per-chain                                                                            | browser wallet — **stage-2**      |
| `apps/agency` | agencies    | agency-side signing if/when it lands                                                                                       | browser wallet (same as fund)     |
| `apps/pay`    | tenants     | nothing                                                                                                                    | `publicId` bearer — **no wallet** |

Two reference implementations inform this, both Stellar:

- [`wmendes/stellar-album-2026`](https://github.com/wmendes/stellar-album-2026) — a clean `connect/restore/disconnect/sign` pattern, **but uses `allowAllModules()`** (the exact CVE source — rejected).
- **[`mutav-finance/mutav-pulse`](https://github.com/mutav-finance/mutav-pulse)** — our own Stellar-hackathon reserve vault. It already uses **Stellar Wallets Kit v2.3.0 with explicit modules** (Freighter/Albedo/xBull imported by subpath — no `allowAllModules`), a `makeSignTransaction()` that plugs into Soroban **contract bindings**, a `signAndSubmit()` raw-XDR path, and a `WalletProvider`/`useWallet()` context. **This is the reference implementation for `@mutav/wallet`.**

**Corrected misstep:** the first draft of this ADR (and #157) specified a separate Ledger-direct (`hw-app-str` + WebHID) path for admin. Unnecessary — Freighter (and others) already back a Ledger, and the real admin security is the **multisig quorum**, not the signing transport.

## Decision

### A. Wallet integration — firm

1. **One `@mutav/wallet` for every signing surface**, built on **Stellar Wallets Kit v2** with **explicit modules only** (`new FreighterModule()` etc. imported by subpath; **never `allowAllModules()`**). Mirrors `mutav-pulse/frontend/lib/wallet.ts`. **No separate `ledger/` package** — hardware is per-admin via Freighter+Ledger.
2. **API mirrors mutav-pulse:**
   - `connect()` / `disconnect()` (kit v2: `StellarWalletsKit.init(...)` once, `authModal()` → `{ address }`).
   - `makeSignTransaction(address)` → a `signTransaction` fn compatible with stellar-sdk `ContractClient` / `AssembledTransaction.signAndSend()` — the **Soroban-bindings** path.
   - `signAndSubmit(xdr)` → kit-sign → `rpc.sendTransaction` → poll to SUCCESS, for raw XDR outside bindings.
   - `WalletProvider` / `useWallet()` context → `{ address, connecting, error, connect, disconnect, signAndSubmit }`.
3. **No custom lint rule.** v2's explicit-subpath imports mean `allowAllModules` is simply never imported; a one-line `no-restricted-imports` on it is belt-and-suspenders — not #157's bespoke ESLint package.
4. **`pay` stays wallet-free** (mirrors the no-Auth0-SDK posture in [ADR 0003](0003-persona-app-origin-isolation-single-convex.md) #2).
5. **Target [SEP-43](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0043.md) (Standard Web Wallet API).** Stellar Wallets Kit aligns with it; keep our wrapper's surface SEP-43-shaped so new wallets drop in without app changes.

### B. Admin authority — quorum is account-side, not frontend (firm direction; pilot account model open)

6. **Admin signing is M-of-N multisig; the quorum lives in the account/contract, signed by admins' personal connected wallets** (the same kit). An admin holds two independent things — a `mutavStaff` row (Tier-1 panel access) **and** a personal pubkey enrolled as a multisig signer (Tier-2 money authority) — exactly [ADR 0004](0004-pilot-cover-default-coverage-draw.md) §4's two-tier model. Onboarding/offboarding an admin's money authority = add/remove their signer.
7. **Two horizons** (per Stellar's own contract-account guidance: classic = "simplest path"; contract account = when you need "on-chain rules such as spend caps, allow lists, or timelocks"):
   - **Native Stellar multisig** (`G…` account, N signers, threshold M) — no contract; the pilot-fastest path to a real `cover_default` quorum.
   - **Soroban contract account** (`C…`, OpenZeppelin smart account) — when on-chain **policy** is wanted (per-draw spend caps, timelocks, allowlists, passkeys). This is the mutav-pulse `vault`/`policy`/`registry` pattern and the `CLAUDE.md` "OZ Smart Account" end-state.

   **The frontend wallet code is identical for both** — each admin signs with their wallet; only the account/contract differs. So we build the integration once and evolve the _account_ later without touching app code.

8. **Multi-party signing coordination** uses Stellar standards: [SEP-7](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) (URI signing requests), [SEP-19](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0019.md) (bootstrapping multisig submission), [SEP-21](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0021.md) (on-chain signature sharing) — collect M signatures on the same XDR, submit when threshold met. [SEP-30](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0030.md) for multi-party admin-key recovery. If admin authority is a contract account, authenticate it with [SEP-45](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0045.md) (web auth for `C…` accounts), alongside SEP-10 for classic accounts.

### C. Vault alignment — firm direction (detail deferred)

9. **The reserve vault targets [SEP-56](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0056.md) (Tokenized Vault Standard)** — deposit underlying → mint shares; extends [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) (Soroban token). SEP-56 is OpenZeppelin-authored, the Soroban analog of ERC-4626, and is what mutav-pulse's vault targets — making DeFindex/Soroswap/Blend yield composable. Detailed vault design is **out of scope for this wallet ADR** (own vault ADR).

## Result (target shape)

```
packages/wallet/                    # @mutav/wallet — one package, Stellar Wallets Kit v2
├── package.json                    # deps: @creit.tech/stellar-wallets-kit@^2, @stellar/stellar-sdk@^15
└── src/
    ├── kit.ts                      # StellarWalletsKit.init({ modules: [Freighter, xBull, Lobstr/Albedo] })
    ├── session.ts                  # connect / disconnect / signAndSubmit  (mutav-pulse pattern)
    ├── signer.ts                   # makeSignTransaction(address) for Soroban ContractClient bindings
    └── provider.tsx                # WalletProvider + useWallet() context
```

- **Consumed by** `apps/fund` + `apps/agency` + `apps/admin` (each lists `@mutav/wallet` in `transpilePackages`). `pay`: none.
- **No** `allowAllModules` adapter packages, **no** `hw-app-str`/WebHID.
- **Admin account:** native multisig (pilot candidate) **or** OZ contract account (end-state) — Decision #7; identical wallet code either way.

## Consequences

**Positive:** the CVE surface that forced the removal is gone by construction (explicit subpath module imports); one wallet integration serves all surfaces; admin security is the _quorum_ (compromising one admin's wallet can't act alone) rather than a special transport; the `makeSignTransaction` path wires straight into Soroban vault bindings; standards-aligned (SEP-43/45/56/7/19/21/30).

**Negative / cost:** re-adopts a previously-removed dependency — hold the explicit-modules line and watch transitive advisories on every kit bump. Multi-party signing needs a coordination surface in `apps/admin` (propose → collect M sigs → submit).

## Alternatives rejected

- **`allowAllModules()`** (album + dapp-skill default) — the 9-CVE adapter surface.
- **A dedicated `@mutav/wallet/ledger` (`hw-app-str` + WebHID) path** — Freighter+Ledger covers hardware with zero bespoke code.
- **#157's custom `no-allow-all-modules` ESLint rule** — moot under v2 explicit imports.
- **Separate per-surface wallet packages** — one package serves all; the quorum is an account concern.

## Open / under investigation

- **Pilot admin authority:** native Stellar multisig vs Soroban contract account (drives #201 / §D).
- **Module set:** Freighter + xBull + (Lobstr and/or Albedo).
- **SEP-56 vault** contract design — separate vault ADR.
- **SEP-43 conformance** of the `@mutav/wallet` wrapper surface.
- Confirm Stellar Wallets Kit **v2** API + any peer-dep/CVE deltas vs the removed version.

## Supersedes

[#157](https://github.com/mutav-finance/mutav-app/pull/157) — its per-surface intent is adopted; its scaffolding (Ledger path, custom lint rule, stale docs location) is dropped in favor of the mutav-pulse pattern. Close #157 once this lands.
