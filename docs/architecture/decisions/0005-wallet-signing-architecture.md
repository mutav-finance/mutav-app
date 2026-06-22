# ADR 0005 — Wallet-signing architecture: one `@mutav/wallet`, per-surface posture

**Status:** Accepted (2026-06-22) · **Supersedes** the [#157](https://github.com/mutav-finance/mutav-app/pull/157) draft spec · Resolves the "vetted, low-CVE replacement" deferred in `CLAUDE.md` when `@creit.tech/stellar-wallets-kit` was removed (9 critical CVEs via unused Trezor/HOT/NEAR adapters).

## Context

`mutav-app` has **three transaction-signing surfaces** with different trust postures, plus one that signs nothing:

| Surface       | Who         | Signs                                                                                                                                                                                          | Posture                             |
| ------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `apps/admin`  | Mutav staff | reserve-vault `cover_default`, treasury-adjacent ops (pilot §D / [#201](https://github.com/mutav-finance/mutav-app/issues/201), [#208](https://github.com/mutav-finance/mutav-app/issues/208)) | **hardware wallet** — highest value |
| `apps/fund`   | investors   | deposits / redemptions; wallet-as-identity, per-chain `(chain, address)`                                                                                                                       | browser wallet — **stage-2**        |
| `apps/agency` | agencies    | agency-side signing (if/when it lands) — same UX as fund                                                                                                                                       | browser wallet                      |
| `apps/pay`    | tenants     | nothing                                                                                                                                                                                        | `publicId` bearer — **no wallet**   |

The earlier `@creit.tech/stellar-wallets-kit` integration was removed (2026-05) after **9 critical CVEs** pulled in transitively by `allowAllModules()` — the Trezor / HOT / NEAR adapters we never invoked. The browser flow here is modeled on [`wmendes/stellar-album-2026`](https://github.com/wmendes/stellar-album-2026) (`frontend/src/lib/wallet.ts`): a clean ~80-line `connect` / `restore` / `disconnect` / `signTransaction` pattern. **The album uses `allowAllModules()`; we explicitly do not** — that is the single change that makes the kit safe to re-adopt.

The #157 draft reached the right per-surface decision but over-built the guardrail (a bespoke ESLint rule + test) and went stale (the `docs/superpowers/specs/` → `docs/architecture/` rename plus a lockfile conflict). This ADR supersedes it; the implementation starts fresh from the album pattern with our two decisions applied (explicit modules; admin off the browser kit).

## Decision

1. **One package, two independent entry points.** `@mutav/wallet` exports `@mutav/wallet/browser` (fund + agency) and `@mutav/wallet/ledger` (admin) with **zero shared runtime code**, so `apps/admin` tree-shakes the browser kit — and its CVE surface — to nothing. Per-file subpaths, no barrel (monorepo package rule).

2. **Browser surfaces use explicit modules only — never `allowAllModules()`.** `@mutav/wallet/browser` wraps `@creit.tech/stellar-wallets-kit` with a hard-coded list: `[FreighterModule, LobstrModule, XBullModule]`, Freighter the default highlight. Trezor / HOT / WalletConnect / NEAR are not bundled — they are the CVE source and need peer deps / a WalletConnect `projectId` we don't want.

3. **Browser API mirrors the album.** `connect()` opens the kit modal → `setWallet(id)` → `getAddress()`; persists only the **wallet id** (never keys) in `localStorage`; `restore()` silently re-establishes on load; `disconnect()` clears it; `signTransaction(xdr)` delegates to `kit.signTransaction`. Keys never leave the wallet.

4. **Admin uses Ledger-direct.** `@mutav/wallet/ledger` uses `@ledgerhq/hw-app-str` over a WebHID transport — **no `@creit.tech` dependency at all**. This is the hardware-wallet authority path for `cover_default` and admin signing (the cold-key role in the authority model — see `CLAUDE.md` § Authority model and [ADR 0004](0004-pilot-cover-default-coverage-draw.md) §4).

5. **Guardrail is `no-restricted-imports`, not a custom rule.** ESLint forbids importing `allowAllModules` from the kit and forbids the heavy adapter packages (`@trezor/*`, `@hot-labs/*`, NEAR) repo-wide. Lighter than #157's bespoke rule, same protection; the constraint is small enough to live in `eslint.config.mjs`.

6. **`apps/pay` stays wallet-free** — `publicId` bearer, no wallet SDK in its dependency list (mirrors the no-Auth0-SDK posture in [ADR 0003](0003-persona-app-origin-isolation-single-convex.md) #2).

7. **Multi-chain-ready.** Identity is chain-namespaced `(chain, address)` from day one (Stellar v1; Solana / EVM later are one adapter file each). No cross-chain identity unification — consistent with [`investor.md`](../investor.md) and trust boundary #2 in [`README.md`](../README.md).

## Result (target shape)

```
packages/wallet/
├── package.json                 # exports "./browser" and "./ledger" subpaths
├── src/
│   ├── browser/
│   │   ├── kit.ts               # StellarWalletsKit, modules: [Freighter, Lobstr, XBull]
│   │   └── session.ts           # connect / restore / disconnect / signTransaction (album pattern)
│   └── ledger/
│       └── signer.ts            # hw-app-str + WebHID: getAddress / signTransaction
```

**Public surface (per the album):**

```ts
// @mutav/wallet/browser
connect(): Promise<string>            // opens picker, returns address, persists wallet id
restore(): Promise<string | null>     // silent reconnect on load, or null
disconnect(): void                    // forget saved session
signTransaction(xdr): Promise<{ signedTxXdr: string }>

// @mutav/wallet/ledger
getAddress(): Promise<string>
signTransaction(xdr): Promise<{ signedTxXdr: string }>
```

- **Deps:** add `@creit.tech/stellar-wallets-kit` (browser) + `@ledgerhq/hw-app-str` and `@ledgerhq/hw-transport-webhid` (ledger), pinned once at root (single-version policy). No `allowAllModules` adapter packages.
- **Wiring:** `apps/fund` + `apps/agency` consume `@mutav/wallet/browser`; `apps/admin` consumes `@mutav/wallet/ledger`. Each lists `@mutav/wallet` in `next.config.ts` `transpilePackages`.
- **Sequencing (pilot-first):** ship **`ledger/` first** — it is the pilot's load-bearing signing path (reserve-vault `cover_default`, §208 §D / #201). `browser/` follows for fund/agency (fund is stage-2 per the pilot scope).

## Consequences

**Positive:** the CVE surface that forced the original removal is gone (explicit modules); admin signing is physically isolated from browser-wallet code (a kit CVE cannot reach staff/treasury signing); the browser API is a proven ~80-line pattern; one package serves all signing surfaces with two tree-shakable entry points.

**Negative / cost:** re-adopts a previously-removed dependency — the explicit-modules line is load-bearing and must be held (hence the lint guard). Ledger + WebHID requires a Chromium-family browser; the admin runbook documents the support matrix. The browser kit's own transitive advisories must be watched on every bump.

## Alternatives rejected

- **`allowAllModules()`** (the album's default) — re-introduces the 9-CVE adapter surface; the entire reason for #157 and this ADR.
- **#157's custom `no-allow-all-modules` ESLint rule** — over-built; `no-restricted-imports` covers it with no package to maintain.
- **Separate per-surface wallet packages** — unnecessary; one package with two tree-shakable entry points achieves the admin/browser isolation.
- **Keep wallet code app-local** — would duplicate the kit setup across fund + agency; promote to a package per the monorepo rule.
- **Smart-account / passkey wallets, Wallet Standard adapter, OZ Relayer (gasless)** — deferred to a later iteration; the chain-namespaced shape leaves room for them.

## Supersedes

[#157](https://github.com/mutav-finance/mutav-app/pull/157) — its per-surface decision is adopted here; its scaffolding (custom lint rule, stale docs location, lockfile churn) is dropped in favor of a fresh build on the album pattern. Close #157 as superseded once this lands.
