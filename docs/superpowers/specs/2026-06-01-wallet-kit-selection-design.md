# Wallet kit selection — design

**Status:** PARKED 2026-06-01 — Approach A blocked at Task 4 of the foundation plan. The `@creit.tech/stellar-wallets-kit` package ships its adapter SDKs (Trezor / Hot Wallet / NEAR Snap / WalletConnect) as regular `dependencies`, so installing the kit pulls in 1 critical + 20 high CVEs (protobufjs `GHSA-xq3m-2v4x-88gg` arbitrary code exec; axios prototype-pollution / credential-theft chain) at every recently-published version (1.7.5, 1.9.5, 2.2.0). The spec's "explicit module imports avoid CVEs" mitigation is unworkable because it only prevents runtime execution; the vulnerable files still install and ship. **Pick-up requires choosing between**: Approach B (hand-rolled per-wallet integrations using `@stellar/freighter-api` + per-wallet APIs); Approach D (vendor-fork the kit, strip adapter SDKs to `peerDependencies`); or Approach E (accept the risk pre-launch with a documented "resolve before mainnet" gate). See PR #157 conversation for the full analysis.
**Owners:** Migration spec § Section 4 follow-up (apps/fund + apps/agency + apps/admin signing); investor portal (`docs/architecture/investor.md`); admin portal (`docs/architecture/admin.md`)
**Last decision date:** 2026-06-01

## Purpose

Select the wallet-signing stack(s) for the three signing surfaces of `mutav-app`. The original `@creit.tech/stellar-wallets-kit` integration was removed on 2026-05-04 after `npm audit` flagged 9 critical CVEs traced to bundled adapters (`trezor-connect`, `@hot-labs/hot-wallet`, NEAR Wallet) the app never invoked. This spec replaces the placeholder TODOs that `apps/fund/` (PR 4), `apps/agency/` (PR 2), and `apps/admin/` (PR 7) all carry; unblocks the `mutav-fund` archive (per the [monorepo migration spec § Section 4](2026-05-31-monorepo-migration-design.md), the fund's wallet-kit port is one of three archive checkpoints); and feeds the v1 admin HW-wallet flow that `apps/admin/` scaffolded but did not wire.

This is a **selection + integration design**. The actual wallet kit code, the `@mutav/wallet` package, and per-app wiring all happen in implementation plans downstream.

## Goal

Pick stacks that:

- Defend against the CVE class that took down the prior integration (bundled-but-unused adapters carrying transitive vulns).
- Match each surface's posture: cold-HW for admin (security-first), browser-wallet for fund (regular-investor UX), shared with agency.
- Stay institutional-grade for admin: device-verified, display-contract enforced, no browser-wallet code anywhere near the HW signing path.
- Code that `apps/fund/`, `apps/agency/`, and `apps/admin/` can consume without reaching across persona-app boundaries.
- Are extensible to multi-chain (Solana / EVM later, per `investor.md`) and to smart-account / passkey patterns later (v2).

## Non-goals

- **Wallet kit IMPLEMENTATION.** Code lives in the writing-plans output, not here.
- **Auth0 wiring** for `apps/admin/`. Covered separately in the [monorepo migration spec § Section 7](2026-05-31-monorepo-migration-design.md).
- **KMS-Action bridge** for operator key custody. Covered in [`mutav-stellar#64`](https://github.com/mutav-finance/mutav-stellar/pull/64).
- **Gasless / fee-sponsored transactions.** OpenZeppelin Relayer is a v2 path; investor signs with their own XLM in v1.
- **Smart account / passkey wallets** (`smart-account-kit`, WebAuthn). A v2 forward path; v1 connects existing investor wallets.
- **Wallet Standard adapter.** Currently <2 Stellar wallets advertise WS support; monitor and revisit.
- **Trezor support** anywhere in v1. The CVE history makes Trezor's Stellar adapter the highest-risk surface; revisit only after independent audit.
- **Cross-chain identity unification.** One profile per `(chain, wallet)` per `investor.md`. Not in scope here.
- **`apps/marketing/` / `apps/docs/`** — neither surface signs.

## Section 1 — Topology

| Surface | Stack | Primary concern |
|---|---|---|
| `apps/admin` | `@ledgerhq/hw-app-str` + `@ledgerhq/hw-transport-webhid` (direct integration, no browser-wallet code) | **Security** — cold HW signing; mandatory device verification |
| `apps/fund` (investor) | Stellar Wallets Kit with **explicit modules** only: `FreighterModule`, `LobstrModule`, `XBullModule` | **UX for regular investors** — connect-wallet picker, one-click sign |
| `apps/agency` (staff USDC payments) | Same as `apps/fund` — shared `@mutav/wallet/browser` import | UX (same as investor); reuses the kit + adapter components |

The split is load-bearing: a CVE in browser-wallet code must not reach the admin HW-signing path. The `@mutav/wallet` package (Section 7) is structured so `apps/admin` cannot transitively import any browser-wallet adapter.

## Section 2 — Browser-wallet stack (fund + agency)

### Library

`@creit.tech/stellar-wallets-kit` pinned to an audited version (exact pin, no carets). The library is the most familiar Stellar dapp wallet abstraction and includes a polished connect-wallet modal. Selected per Section 1's "regular investor UX" priority.

### Module discipline (load-bearing)

Modules are imported **explicitly**:

```ts
import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
  LobstrModule,
  XBullModule,
} from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({
  network: WalletNetwork.PUBLIC,
  modules: [
    new FreighterModule(),
    new LobstrModule(),
    new XBullModule(),
  ],
});
```

**`allowAllModules()` is forbidden.** The original CVEs came from this default-bundle-everything pattern — Trezor / Hot Wallet / NEAR adapters got installed and their transitive deps were flagged. Forbidding this pattern is the primary CVE mitigation. Enforcement in Section 6.

### Network selection

- `NEXT_PUBLIC_STELLAR_NETWORK` env var: `"PUBLIC"` for production, `"TESTNET"` for preview/dev.
- The kit's `network` option is set from this env var.
- On connect, the app fetches the wallet's network and aborts the connection if they mismatch — with a clear error in the UI.

### Wallet picker UI

- Use the kit's built-in modal.
- Theme it against the shadcn token scale (`@mutav/ui` provides theme tokens).
- No custom picker; the kit's modal is well-tested and matches investor expectations.

### Three v1 wallets, rationale

- **Freighter** — desktop browser extension. Most common Stellar wallet for developers / power users.
- **Lobstr** — mobile-first; large retail Stellar investor base.
- **xBull** — cross-platform; supports advanced flows.

Adding a fourth wallet later = add one `import` + one `new Module()` call. Removing the kit later is a Section-7 abstraction change.

## Section 3 — Admin HW-wallet stack

### Libraries

- `@ledgerhq/hw-app-str` — Stellar app interface for Ledger devices
- `@ledgerhq/hw-transport-webhid` — browser WebHID transport (chrome / edge / opera; firefox needs separate transport)

No umbrella kit, no browser-wallet dependencies in `apps/admin/`. The `@mutav/wallet/ledger` submodule (Section 7) has no transitive dep on Freighter / Lobstr / xBull adapters.

### Display contract (load-bearing)

Per `mutav-stellar/docs/architecture/02-actors-and-trust.md`:

> Investor/admin tx-display contract: the connected wallet's UI is the last line of defense against a malicious tx; the persona apps should never silently submit, always show recipient + amount. Especially load-bearing for admin operations signed via hardware wallet inside `apps/admin/`.

For every admin tx:

1. `apps/admin/` renders the operation details in the page UI: function name, every arg, destination address (full, not truncated for signing), amount, network. User reviews on screen.
2. The Ledger device shows a hash of the same XDR + the operation type + the destination + the amount.
3. User confirms on device.
4. If device-shown details disagree with page-shown details → user aborts. This must be a documented step in the runbook (`docs/ops/admin-hw-wallet-rubric.md`).

The implementation must explicitly verify the device returns a signature matching the displayed XDR; reject if the bytes differ.

### Trezor — explicit non-decision

Trezor's Stellar adapter is the historical CVE source. Not supported in v1. Revisit only after independent audit AND a Mutav-internal decision that Ledger-only is insufficient for the admin team's hardware.

### Connection lifecycle

- WebHID permission prompted on first connection.
- Transport closed after each signature (no persistent connection).
- Re-prompt on every signature unless the user explicitly enables "remember device" — and even then re-prompt after session timeout (12h per spec § Section 7).

## Section 4 — Wallet-as-identity contract

Per [`docs/architecture/investor.md`](../../architecture/investor.md) § "Wallet as identity (per chain)":

- Investor profile keyed on `(chain, address)`. One profile per `(chain, wallet)` — no cross-chain identity unification in v1.
- Convex stores per-user offchain state: KYC status, notification prefs, redemption queue cache, display name.
- **Reads**: nothing proves identity for reads — the wallet address is in URL / UI state. Data scoped to that address is shown.
- **Writes**: wallet signs the transaction. Convex never sees private keys. Convex composes XDR if needed; the wallet signs it client-side.
- Investor profile row is lazily created on first connect: `investors.upsert({ chain: 'stellar', address })`.

This contract is unchanged by the wallet kit choice. The kit produces a signed XDR; the rest of the pipeline (XDR → submit → confirmation) goes through `mutav-stellar`'s SDK and the relevant Convex tables.

## Section 5 — Signing flow

The flow is the same for browser-wallet and HW signing (only the `sign` step differs).

1. **Build XDR.** `apps/<surface>/` calls a builder from the `mutav-stellar` SDK (per [orphan-verdict ADR](https://github.com/mutav-finance/mutav-stellar/blob/main/docs/architecture/decisions/2026-05-30-daemon-prs-orphan-verdict.md) PR B — the SDK exports XDR-only builders, no signing). Example: `buildReceivePaymentOp(...)` or `buildDepositInvestorOp(...)`.
2. **Sign XDR.**
   - Browser-wallet (`fund` / `agency`): `await kit.signTransaction(xdr)` → `{ signedTxXdr }`.
   - HW (`admin`): `await ledger.signTransaction(xdr, derivationPath)` → `signedXdr`. Verify signature length + signer pubkey before continuing.
3. **Submit.** `apps/<surface>/` calls `await Server.sendTransaction(signedXdr)` against the configured Soroban RPC.
4. **Confirm.** Poll RPC for confirmation; surface result in the UI. On failure, render the error class (auth failed, account not found, network mismatch, etc.) clearly.

The wallet kit is **signing-only**. No XDR construction or RPC submission lives inside the wallet abstraction; that is the SDK's job and the app's job.

## Section 6 — Security guards

Enforce the Section 2 / Section 3 commitments programmatically:

| Guard | Mechanism |
|---|---|
| Block `allowAllModules()` | Custom ESLint rule `@mutav/wallet/no-allow-all-modules` — fails CI |
| Block any import of `@creit.tech/stellar-wallets-kit/**/*allowAll*` paths | Same rule + `no-restricted-imports` entry in root `eslint.config.mjs` |
| Block import of any Stellar wallet kit module from inside `apps/admin/**` | `eslint-plugin-import` `no-restricted-paths` rule — `apps/admin/**` cannot import from `@mutav/wallet/browser` or directly from `@creit.tech/stellar-wallets-kit` |
| Block any `@ledgerhq/*` import outside `apps/admin/**` + `@mutav/wallet/ledger/**` | Same `no-restricted-paths` mechanism |
| Audit on every PR | `bun audit --severity=high` step in `.github/workflows/quality.yml`; fails on any new high or critical CVE |
| Pinned versions | `package.json` uses **exact versions** (no `^` or `~`) for all wallet-adjacent packages (`@creit.tech/stellar-wallets-kit`, `@ledgerhq/hw-app-str`, `@ledgerhq/hw-transport-webhid`). Lockfile is the source of truth. |
| Net-new CVE detection on PR | GitHub Action `dependency-review-action@v4` — fails the PR if it adds any new CVE-flagged transitive dep |
| Display contract enforcement (admin) | Code-review checklist item; vitest integration test that fakes a tampered post-sign XDR and verifies the UI aborts |

The custom ESLint rule and the audit step are the two new pieces; the rest is configuration tightening.

## Section 7 — Where the code lives

A new `packages/wallet` workspace package (extracted via the same on-demand pattern as PR 6 packages):

```
packages/wallet/
├── package.json                     # @mutav/wallet — workspace:* deps only
├── tsconfig.json                    # extends ../tsconfig/nextjs.json
├── README.md
└── src/
    ├── browser/                     # consumed by apps/fund + apps/agency
    │   ├── index.ts                 # public API
    │   ├── kit.ts                   # kit instance factory
    │   ├── hooks.ts                 # useWallet, useConnect, useSignXdr
    │   ├── picker.tsx               # opens kit modal; theme'd
    │   └── network.ts               # NEXT_PUBLIC_STELLAR_NETWORK reader + mismatch guard
    ├── ledger/                      # consumed by apps/admin
    │   ├── index.ts
    │   ├── transport.ts             # WebHID transport factory
    │   ├── hooks.ts                 # useLedger, useLedgerSign
    │   ├── verify.ts                # display-contract verification
    │   └── path.ts                  # derivation paths (BIP44 `m/44'/148'/0'`)
    ├── types.ts                     # WalletConnection, SigningResult, WalletError
    ├── test/                        # vitest test fixtures
    │   └── mock-kit-module.ts       # MockKitModule for unit/integration tests
    └── lint/                        # custom ESLint rule
        ├── index.ts
        └── no-allow-all-modules.ts
```

Imports:

- `apps/fund/src/**` → `@mutav/wallet/browser`
- `apps/agency/src/**` → `@mutav/wallet/browser`
- `apps/admin/src/**` → `@mutav/wallet/ledger`
- ESLint rules (Section 6) forbid cross-imports.

The `browser/` and `ledger/` subdirs have **zero shared runtime code** — `types.ts` only. Tree-shaking guarantees `apps/admin` doesn't pull `@creit.tech/stellar-wallets-kit` into its bundle.

## Section 8 — Test plan

### Unit tests (vitest)

- XDR builder return values + envelope shape — pure functions in `mutav-stellar` SDK, already covered.
- `network.ts` — `NEXT_PUBLIC_STELLAR_NETWORK` reader, mismatch detection.
- `path.ts` — BIP44 derivation path construction.
- `verify.ts` — display-contract verification logic: tampered XDR rejected, matched XDR accepted.

### Mock wallet adapter

`@mutav/wallet/test` exports a `MockKitModule` that implements the kit's module interface. vitest uses it to simulate:
- Successful sign + return signed XDR
- User rejects (throws known error class)
- Wallet network mismatch
- Wallet disconnects mid-signing
- Wallet returns malformed XDR

### Integration tests (Playwright, in apps/fund + apps/agency)

- Connect-wallet modal opens on first click
- Wallet pick → connect → address rendered
- Sign flow happy path (using `MockKitModule`)
- Sign flow rejection path (renders rejection cleanly)

### HW wallet (apps/admin)

- **Manual rubric** in `docs/ops/admin-hw-wallet-rubric.md`. Cannot be automated without a Ledger device + WebHID.
- Rubric covers: device connect, derivation-path verification, display-contract walkthrough (user must abort if device shows wrong destination), session timeout.

## Section 9 — Forward-proofing

### Multi-chain (Solana / EVM later)

- `@mutav/wallet/browser` is **chain-namespaced** from day one. Every hook takes a `chain: 'stellar' | 'solana' | 'ethereum'` discriminant.
- Adding Solana later = add `@mutav/wallet/browser/solana.ts` with a Solana adapter; no abstraction refactor.
- Investor profile rows already key on `(chain, address)` per Section 4.

### Smart accounts (passkeys, `smart-account-kit`)

- The dapp skill recommends `smart-account-kit` for passwordless / on-chain accounts with policies (threshold multisig, spending limits).
- This is a strong v2 path — better UX than "go install Freighter first" — but **out of v1 scope** because:
  - Regular investors connect existing wallets in v1 (the user's stated UX priority).
  - Smart account creation requires WebAuthn UI work and a custom relayer integration.
- When v2 lands: add `@mutav/wallet/smart-account/` alongside `browser/` and `ledger/`. Add a fourth row to Section 1's topology table.

### Wallet Standard

- Cross-wallet discovery protocol (Solana popularized; Stellar ecosystem early-stage).
- Monitor Freighter + Lobstr + xBull for WS support. When 2+ advertise themselves: add a Wallet Standard adapter to `@mutav/wallet/browser/`. Investor sees their wallet auto-discovered; no kit module per wallet.

### Gasless / OpenZeppelin Relayer

- The dapp skill calls out OZ Relayer for fee-bump sponsorship. Useful for investors who hold USDC but not XLM.
- Out of v1 (investor brings their own XLM).
- When v2 lands: add an optional sponsor parameter to `useSignXdr` that wraps the signed XDR in a fee bump.

## Section 10 — Out of scope (explicit)

Called out so absence is not mistaken for an oversight:

- **Wallet kit IMPLEMENTATION** — the `@mutav/wallet` package, the ESLint rule body, per-app wiring all live in the writing-plans output.
- **Auth0 wiring inside `apps/admin/`** — covered by spec § Section 7 in [`2026-05-31-monorepo-migration-design.md`](2026-05-31-monorepo-migration-design.md).
- **KMS-Action bridge** for operator key custody — [`mutav-stellar#64`](https://github.com/mutav-finance/mutav-stellar/pull/64).
- **Smart account / passkey wallets** — v2 (Section 9).
- **Wallet Standard adapter** — v2 (Section 9).
- **Gasless / OpenZeppelin Relayer** — v2 (Section 9).
- **Trezor** — explicit non-decision (Section 3); revisit post-audit.
- **Cross-chain identity unification** — `investor.md` calls this out as architecturally rejected.
- **Marketing or docs apps** — neither surface signs.
- **`mutav-fund` repo** — soft-deprecated. Wallet code does NOT port from there (the repo has no wallet code; package.json only depends on `@stellar/stellar-sdk`). This spec is a fresh selection.

## Section 11 — Open follow-ups

| Item | Tracked at | Notes |
|---|---|---|
| Implementation plan for `@mutav/wallet` | writing-plans output, after this spec is approved | Package scaffold, kit factory, hooks, custom ESLint rule, mock module |
| Per-app wiring (apps/fund, apps/agency, apps/admin) | Separate per-app specs | Each app's connect-wallet UX, signing flow plumbing |
| Admin HW-wallet runbook (`docs/ops/admin-hw-wallet-rubric.md`) | Pre-mainnet ops milestone | Manual test rubric for HW signing flow |
| Smart account / passkey wallets (v2) | Future spec | Reuses Section 7's `@mutav/wallet/smart-account/` placement |
| Wallet Standard adapter (v2) | Trigger: 2+ Stellar wallets advertise WS | Adds `@mutav/wallet/browser/wallet-standard.ts` |
| Multi-chain (Solana / EVM) (v2) | Trigger: chain choice locked, indexer module written | Per-chain adapter file under `@mutav/wallet/browser/` |
| `apps/fund` real investor flows (deposit / redeem) | `apps/fund` build-out spec | Consumes this wallet kit + the `@mutav-stellar` SDK |
| `mutav-fund` archive | Gated on all three checkpoints from monorepo migration spec § Section 4 | This spec lands → wallet kit ports into `apps/fund/` → parity audit |
| Audit step in CI | `quality.yml` change | `bun audit --severity=high` |
| Dependency-review action | `.github/workflows/quality.yml` change | `actions/dependency-review-action@v4` |

## References

- [`docs/architecture/investor.md`](../../architecture/investor.md) — Wallet-as-identity contract; per-chain account model; KYC boundary
- [`docs/architecture/admin.md`](../../architecture/admin.md) — Admin shell; sub-roles; HW-wallet posture
- [`docs/architecture/README.md` § App catalog](../../architecture/README.md#app-catalog) — Origin/auth/cookie posture per persona
- [`docs/superpowers/specs/2026-05-31-monorepo-migration-design.md`](2026-05-31-monorepo-migration-design.md) — Section 1 (load-bearing constraints); Section 4 (mutav-fund archive checkpoints); Section 7 (Auth0 posture)
- [`mutav-stellar/docs/architecture/02-actors-and-trust.md`](https://github.com/mutav-finance/mutav-stellar/blob/main/docs/architecture/02-actors-and-trust.md) — Trust model; display contract; admin cold-wallet posture
- [`mutav-stellar/docs/architecture/decisions/2026-05-30-daemon-prs-orphan-verdict.md`](https://github.com/mutav-finance/mutav-stellar/blob/main/docs/architecture/decisions/2026-05-30-daemon-prs-orphan-verdict.md) — SDK exports XDR-only builders (no signing)
- [`mutav-stellar/docs/specs/2026-05-31-operator-key-runbook-design.md`](https://github.com/mutav-finance/mutav-stellar/blob/main/docs/specs/2026-05-31-operator-key-runbook-design.md) — Operator-key runbook; KMS bridge; admin HW reference
- Stellar dapp skill: `~/.claude/plugins/marketplaces/stellar-dev/skills/dapp/SKILL.md` — Library options (Freighter, Stellar Wallets Kit, smart-account-kit, OZ Relayer)
- Original CVE removal: `mutav-app` README "Stellar wallet connection is currently unwired" note + auto-memory `project_sgr_app_no_privy` (Privy was a separate prior rejection)
