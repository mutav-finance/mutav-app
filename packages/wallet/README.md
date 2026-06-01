# @mutav/wallet

Wallet-signing primitives for the four persona apps.

## Subpath imports

| Import path             | Used by                    | Provides                                                      |
| ----------------------- | -------------------------- | ------------------------------------------------------------- |
| `@mutav/wallet/browser` | `apps/fund`, `apps/agency` | Stellar Wallets Kit factory + React hooks                     |
| `@mutav/wallet/ledger`  | `apps/admin` (future)      | `@ledgerhq/hw-app-str` integration                            |
| `@mutav/wallet/test`    | All apps' vitest suites    | `MockKitModule` for unit tests                                |
| `@mutav/wallet/lint`    | Root `eslint.config.mjs`   | Custom rules (`no-allow-all-modules`)                         |
| `@mutav/wallet/types`   | All consumers              | `WalletConnection`, `SigningResult`, `WalletError`, `Network` |

## Security rules

- **`allowAllModules()` is forbidden.** The custom ESLint rule `no-allow-all-modules` enforces this. See spec § Section 2.
- `apps/admin/**` cannot import from `browser/` or directly from `@creit.tech/stellar-wallets-kit`. Enforced by `no-restricted-paths` in root ESLint config.

See `docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md` for the full design.
