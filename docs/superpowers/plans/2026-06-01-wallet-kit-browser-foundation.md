# Wallet kit — browser foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the `@mutav/wallet` workspace package with its browser submodule (Stellar Wallets Kit with explicit modules), test infrastructure (`MockKitModule`), custom ESLint rule (`no-allow-all-modules`), and CI audit guards. After this PR merges, `apps/fund/` and `apps/agency/` can import a working browser-wallet kit; per-app wiring lands in subsequent per-app specs.

**Architecture:** A new `packages/wallet/` workspace package with `browser/` and (future) `ledger/` submodules sharing only `types.ts`. The browser submodule wraps `@creit.tech/stellar-wallets-kit` with explicit Freighter / Lobstr / xBull modules — `allowAllModules()` is forbidden by a custom ESLint rule. CI fails on any high or critical CVE via `bun audit` plus GitHub's `dependency-review-action`.

**Tech Stack:** Bun 1.3.1 (workspaces), Turborepo 2.9.16, TypeScript 5.x, React 19, `@creit.tech/stellar-wallets-kit` 1.x (pinned exact), `eslint` 9.x (custom rule), Vitest 4.x.

**Spec:** [`docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md`](../specs/2026-06-01-wallet-kit-selection-design.md) — Sections 1, 2, 5, 6, 7, 8.

---

## File structure

This PR creates 13 new files and modifies 4 existing files.

### New files

| Path | Responsibility |
|---|---|
| `packages/wallet/package.json` | Workspace manifest `@mutav/wallet`; exact-pinned `@creit.tech/stellar-wallets-kit`; subpath exports for `browser`, `test`, `lint`. |
| `packages/wallet/tsconfig.json` | Extends `../tsconfig/nextjs.json`; `noEmit: false` for the `lint` subpath that needs published JS. |
| `packages/wallet/README.md` | Short doc: what this package does, when to import from `browser` vs `ledger` (future), the `allowAllModules()` ban. |
| `packages/wallet/src/types.ts` | `WalletConnection`, `SigningResult`, `WalletError`, `Network` types — the **only** code shared between `browser/` and `ledger/`. |
| `packages/wallet/src/browser/index.ts` | Public API barrel for `@mutav/wallet/browser` (re-exports kit factory + hooks + picker). |
| `packages/wallet/src/browser/kit.ts` | Stellar Wallets Kit instance factory with explicit modules. Pure function — no React. |
| `packages/wallet/src/browser/network.ts` | Reads `NEXT_PUBLIC_STELLAR_NETWORK`; returns `WalletNetwork`; throws on missing/invalid. |
| `packages/wallet/src/browser/use-wallet.tsx` | `useWallet` React hook — observes the current connection state. |
| `packages/wallet/src/browser/use-connect.tsx` | `useConnect` React hook — opens the picker modal + handles selection. |
| `packages/wallet/src/browser/use-sign-xdr.tsx` | `useSignXdr` React hook — signs a Stellar XDR. |
| `packages/wallet/src/test/mock-kit-module.ts` | `MockKitModule` implementing the kit's `Module` interface; configurable response (sign success / reject / network mismatch / malformed XDR). |
| `packages/wallet/src/lint/no-allow-all-modules.ts` | Custom ESLint rule that fails on any reference to `allowAllModules` from `@creit.tech/stellar-wallets-kit`. |
| `packages/wallet/src/lint/index.ts` | ESLint plugin entry: exports `{ rules: { 'no-allow-all-modules': ... } }`. |
| `packages/wallet/src/browser/__tests__/kit.test.ts` | Tests for `kit.ts` and `network.ts` against the mock module. |
| `packages/wallet/src/browser/__tests__/hooks.test.tsx` | Tests for the three hooks using `@testing-library/react` + the mock module. |
| `packages/wallet/src/lint/__tests__/no-allow-all-modules.test.ts` | Tests for the custom ESLint rule using `@typescript-eslint/rule-tester`. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `eslint-plugin-tester` + the new lint plugin to root devDeps if needed for cross-cutting setup. (Most plumbing lives in the package.) |
| `eslint.config.mjs` | Register `@mutav/wallet/lint` as a plugin; enable `no-allow-all-modules` everywhere; add `no-restricted-imports` rule blocking `allowAllModules` named import; add `no-restricted-paths` rule blocking `apps/admin/**` from importing `@mutav/wallet/browser` or `@creit.tech/stellar-wallets-kit`. |
| `.github/workflows/quality.yml` | Add a `bun audit --severity=high` step. Add `dependency-review-action@v4` job for PRs to main. |
| `bun.lock` | Updated automatically by `bun install` after adding `@creit.tech/stellar-wallets-kit`. |

## Verification model

PRs 2–6 of the monorepo migration used "baseline → change → verify identical." This plan adds NEW code, so the model is:

1. **Baseline** (Task 1) — capture current `typecheck` / `lint` / `test` / `build` / `format:check` / `convex tsc` results.
2. **TDD per task** — write a failing test first, implement, watch it pass.
3. **No regression** — after each implementation task, re-run the relevant scope (`bun --filter @mutav/wallet ...` while iterating; full `bun run typecheck/lint/test` for cross-cutting changes).
4. **Final sweep** (Task 10) — full `bun install` from clean + every check passes.

The "test pre-existing failure" baseline pattern from PR 2 (worktree-leaked `pricing.test.ts`) was resolved in PR 3 — current main has no known pre-existing test failures.

## Pre-flight

- [ ] **Pre-flight 1: Branch off origin/main**

Spec is on `docs/wallet-kit-selection-spec`; this plan extends that branch (so spec + plan ship together in PR #157). Confirm the current branch:

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
git branch --show-current
```

Expected: `docs/wallet-kit-selection-spec`. If different, switch to it:

```bash
git checkout docs/wallet-kit-selection-spec
```

> If the spec PR has already merged before this plan starts, fall back to: `git checkout -b feat/wallet-kit-browser-foundation origin/main`.

- [ ] **Pre-flight 2: Re-read spec § Sections 1, 2, 5, 6, 7, 8**

Open `docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md`. The plan implements exactly those sections; if they disagree with the plan, stop and reconcile.

---

## Task 1: Capture baseline

**Files:** none (read-only).

- [ ] **Step 1: Clean install**

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
bun install
```

Expected: completes without errors.

- [ ] **Step 2: Run each check, capture output**

```bash
bun run typecheck    2>&1 | tee /tmp/walletkit-base-typecheck.log
bun run lint         2>&1 | tee /tmp/walletkit-base-lint.log
bun run test         2>&1 | tee /tmp/walletkit-base-test.log
bun run format:check 2>&1 | tee /tmp/walletkit-base-format.log
bun run build        2>&1 | tee /tmp/walletkit-base-build.log
bunx tsc --noEmit --project convex/tsconfig.json 2>&1 | tee /tmp/walletkit-base-convex-tsc.log
```

Expected: every command exits `0`.

- [ ] **Step 3: Record baseline**

Snapshot summary to `/tmp/walletkit-baseline.txt`:

```bash
cat > /tmp/walletkit-baseline.txt <<'EOF'
wallet-kit foundation baseline — main @ <CURRENT_SHA>
- typecheck:    PASS
- lint:         PASS
- test:         PASS  (counts: 4 packages, N test files, M tests)
- format:check: PASS
- build:        PASS
- convex tsc:   PASS
EOF
```

Replace `<CURRENT_SHA>` with `git rev-parse HEAD` output and `N` / `M` with the actual counts from the test log.

**Task 1 commit:** none.

---

## Task 2: Scaffold `packages/wallet/` skeleton

**Files:**
- Create: `packages/wallet/package.json`
- Create: `packages/wallet/tsconfig.json`
- Create: `packages/wallet/README.md`
- Create: `packages/wallet/src/types.ts`

- [ ] **Step 1: Create `packages/wallet/package.json`**

```json
{
  "name": "@mutav/wallet",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./browser": "./src/browser/index.ts",
    "./test": "./src/test/mock-kit-module.ts",
    "./lint": "./src/lint/index.ts",
    "./types": "./src/types.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "19.2.4"
  },
  "devDependencies": {
    "@mutav/tsconfig": "workspace:*",
    "typescript": "^5",
    "vitest": "^4.1.6"
  }
}
```

Dependencies stay minimal at this point — Stellar Wallets Kit is added in Task 4.

- [ ] **Step 2: Create `packages/wallet/tsconfig.json`**

```json
{
  "extends": "../tsconfig/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `packages/wallet/README.md`**

```markdown
# @mutav/wallet

Wallet-signing primitives for the four persona apps.

## Subpath imports

| Import path | Used by | Provides |
|---|---|---|
| `@mutav/wallet/browser` | `apps/fund`, `apps/agency` | Stellar Wallets Kit factory + React hooks |
| `@mutav/wallet/ledger` | `apps/admin` (future) | `@ledgerhq/hw-app-str` integration |
| `@mutav/wallet/test` | All apps' vitest suites | `MockKitModule` for unit tests |
| `@mutav/wallet/lint` | Root `eslint.config.mjs` | Custom rules (`no-allow-all-modules`) |
| `@mutav/wallet/types` | All consumers | `WalletConnection`, `SigningResult`, `WalletError`, `Network` |

## Security rules

- **`allowAllModules()` is forbidden.** The custom ESLint rule `no-allow-all-modules` enforces this. See spec § Section 2.
- `apps/admin/**` cannot import from `browser/` or directly from `@creit.tech/stellar-wallets-kit`. Enforced by `no-restricted-paths` in root ESLint config.

See `docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md` for the full design.
```

- [ ] **Step 4: Create `packages/wallet/src/types.ts`**

```ts
/**
 * Shared types across @mutav/wallet/browser and @mutav/wallet/ledger.
 * Keep this file minimal — anything specific to one transport lives in
 * that subpath, not here. See spec § Section 7.
 */

export type Network = "PUBLIC" | "TESTNET";

export interface WalletConnection {
  readonly address: string;
  readonly network: Network;
  readonly transport: "browser-kit" | "ledger-hw";
}

export interface SigningResult {
  readonly signedXdr: string;
  readonly signerAddress: string;
}

export type WalletErrorCode =
  | "WALLET_NOT_INSTALLED"
  | "USER_REJECTED"
  | "NETWORK_MISMATCH"
  | "MALFORMED_XDR"
  | "CONNECTION_LOST"
  | "UNKNOWN";

export class WalletError extends Error {
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "WalletError";
  }
}
```

- [ ] **Step 5: Install + verify typecheck**

```bash
bun install
bun --filter @mutav/wallet typecheck
```

Expected: `bun install` regenerates `bun.lock` (the new workspace package is registered); `typecheck` exits `0` (types compile).

- [ ] **Step 6: Commit**

```bash
git add packages/wallet/package.json packages/wallet/tsconfig.json packages/wallet/README.md packages/wallet/src/types.ts bun.lock
git commit -m "feat(wallet): scaffold @mutav/wallet workspace package + shared types"
```

Husky runs `tsc --noEmit` + prettier; commit subject lowercase passes commitlint.

---

## Task 3: Custom ESLint rule — `no-allow-all-modules`

**Files:**
- Create: `packages/wallet/src/lint/no-allow-all-modules.ts`
- Create: `packages/wallet/src/lint/index.ts`
- Create: `packages/wallet/src/lint/__tests__/no-allow-all-modules.test.ts`

- [ ] **Step 1: Add eslint dev deps to the package**

Edit `packages/wallet/package.json` `devDependencies` to add:

```json
    "@typescript-eslint/rule-tester": "^8.0.0",
    "@typescript-eslint/utils": "^8.0.0",
    "eslint": "^9"
```

Run:

```bash
bun install
```

Expected: completes; `bun.lock` updates.

- [ ] **Step 2: Write the failing test**

Create `packages/wallet/src/lint/__tests__/no-allow-all-modules.test.ts`:

```ts
import { RuleTester } from "@typescript-eslint/rule-tester";
import { rule } from "../no-allow-all-modules";

const ruleTester = new RuleTester();

ruleTester.run("no-allow-all-modules", rule, {
  valid: [
    {
      code: `import { FreighterModule } from "@creit.tech/stellar-wallets-kit";`,
    },
    {
      code: `
        import { StellarWalletsKit, FreighterModule } from "@creit.tech/stellar-wallets-kit";
        const kit = new StellarWalletsKit({ modules: [new FreighterModule()] });
      `,
    },
  ],
  invalid: [
    {
      code: `import { allowAllModules } from "@creit.tech/stellar-wallets-kit";`,
      errors: [{ messageId: "noAllowAllModules" }],
    },
    {
      code: `
        import { StellarWalletsKit, allowAllModules } from "@creit.tech/stellar-wallets-kit";
        const kit = new StellarWalletsKit({ modules: allowAllModules() });
      `,
      errors: [
        { messageId: "noAllowAllModules" },
        { messageId: "noAllowAllModules" },
      ],
    },
  ],
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
bun --filter @mutav/wallet test -- src/lint/__tests__/no-allow-all-modules.test.ts
```

Expected: FAIL with "Cannot find module '../no-allow-all-modules'" or similar.

- [ ] **Step 4: Implement the rule**

Create `packages/wallet/src/lint/no-allow-all-modules.ts`:

```ts
import { ESLintUtils } from "@typescript-eslint/utils";

const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/mutav-finance/mutav-app/blob/main/packages/wallet/src/lint/${name}.ts`,
);

const KIT_PACKAGE = "@creit.tech/stellar-wallets-kit";
const FORBIDDEN_NAME = "allowAllModules";

export const rule = createRule({
  name: "no-allow-all-modules",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing or calling allowAllModules from @creit.tech/stellar-wallets-kit. " +
        "Use explicit module imports (FreighterModule, LobstrModule, XBullModule) instead. " +
        "See spec § Section 2.",
    },
    schema: [],
    messages: {
      noAllowAllModules:
        "Importing or calling `allowAllModules` from `@creit.tech/stellar-wallets-kit` is forbidden — use explicit module imports. See spec § Section 2.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value !== KIT_PACKAGE) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === FORBIDDEN_NAME
          ) {
            context.report({ node: specifier, messageId: "noAllowAllModules" });
          }
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === FORBIDDEN_NAME
        ) {
          context.report({ node, messageId: "noAllowAllModules" });
        }
      },
    };
  },
});
```

- [ ] **Step 5: Create the plugin entry**

Create `packages/wallet/src/lint/index.ts`:

```ts
import { rule as noAllowAllModules } from "./no-allow-all-modules";

export const plugin = {
  meta: {
    name: "@mutav/wallet/lint",
    version: "0.1.0",
  },
  rules: {
    "no-allow-all-modules": noAllowAllModules,
  },
};

export default plugin;
```

- [ ] **Step 6: Run test to verify it passes**

```bash
bun --filter @mutav/wallet test -- src/lint/__tests__/no-allow-all-modules.test.ts
```

Expected: PASS — all valid cases produce no errors; all invalid cases produce the `noAllowAllModules` error.

- [ ] **Step 7: Wire into root `eslint.config.mjs`**

Edit `/Users/jubs/Projects/tga-protocol/mutav-app/eslint.config.mjs`. Add to the appropriate flat config entry (the one that covers JS/TS source):

```js
import walletLintPlugin from "@mutav/wallet/lint";

// ... inside the config array:
{
  plugins: {
    "@mutav/wallet": walletLintPlugin,
  },
  rules: {
    "@mutav/wallet/no-allow-all-modules": "error",
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@creit.tech/stellar-wallets-kit",
            importNames: ["allowAllModules"],
            message: "Forbidden — see spec § Section 2.",
          },
        ],
      },
    ],
  },
},
```

> If `eslint.config.mjs` already has a `no-restricted-imports` rule, merge the entries rather than overriding.

- [ ] **Step 8: Run full lint to confirm no new errors**

```bash
bun run lint
```

Expected: exit `0`. The rule has no consumers yet so it shouldn't flag anything.

- [ ] **Step 9: Commit**

```bash
git add packages/wallet/package.json packages/wallet/src/lint/ packages/wallet/src/lint/__tests__/ bun.lock eslint.config.mjs
git commit -m "feat(wallet): custom eslint rule no-allow-all-modules + root config wiring"
```

---

## Task 4: Install Stellar Wallets Kit (pinned exact version)

**Files:**
- Modify: `packages/wallet/package.json`
- Modify: `bun.lock`

- [ ] **Step 1: Add the dependency, exact version**

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
bun add --filter @mutav/wallet --exact @creit.tech/stellar-wallets-kit@1.7.4
```

> Adjust the version `1.7.4` if a later 1.x release is the audited target. The spec says "pinned to an audited version"; this Task fixes the version. Verify via `bun audit` after install — if any high or critical CVE is reported, stop and investigate.

- [ ] **Step 2: Audit the install**

```bash
cd packages/wallet && bunx --bun bun audit --severity=high && cd ../..
```

Expected: no high or critical CVEs reported.

If any are reported, **stop**. Either downgrade to a known-clean version, or escalate the spec to choose Approach B (hand-rolled) or Approach C (Wallet Standard).

- [ ] **Step 3: Verify kit imports resolve**

```bash
bun --filter @mutav/wallet typecheck
```

Expected: exit `0` (no new code yet; package still compiles).

- [ ] **Step 4: Commit**

```bash
git add packages/wallet/package.json bun.lock
git commit -m "feat(wallet): pin @creit.tech/stellar-wallets-kit"
```

---

## Task 5: Browser submodule — `kit.ts` factory + `network.ts`

**Files:**
- Create: `packages/wallet/src/browser/network.ts`
- Create: `packages/wallet/src/browser/kit.ts`
- Create: `packages/wallet/src/browser/index.ts`
- Create: `packages/wallet/src/browser/__tests__/kit.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/wallet/src/browser/__tests__/kit.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readNetwork } from "../network";
import { createKit } from "../kit";

describe("readNetwork", () => {
  const originalEnv = process.env.NEXT_PUBLIC_STELLAR_NETWORK;

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK = originalEnv;
    } else {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    }
  });

  it("returns PUBLIC for production env", () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "PUBLIC";
    expect(readNetwork()).toBe("PUBLIC");
  });

  it("returns TESTNET for testnet env", () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "TESTNET";
    expect(readNetwork()).toBe("TESTNET");
  });

  it("throws on missing env", () => {
    expect(() => readNetwork()).toThrow(
      /NEXT_PUBLIC_STELLAR_NETWORK must be set/,
    );
  });

  it("throws on invalid env", () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "MAINNET";
    expect(() => readNetwork()).toThrow(
      /must be PUBLIC or TESTNET, got MAINNET/,
    );
  });
});

describe("createKit", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = "TESTNET";
  });

  it("constructs a kit with the three explicit modules", () => {
    const kit = createKit();
    // The kit exposes the modules via getSupportedWallets()
    return kit.getSupportedWallets().then((wallets) => {
      const ids = wallets.map((w) => w.id);
      expect(ids).toContain("freighter");
      expect(ids).toContain("lobstr");
      expect(ids).toContain("xbull");
      // Critically: no other wallets bundled
      expect(wallets).toHaveLength(3);
    });
  });

  it("uses the network from env", () => {
    const kit = createKit();
    expect(kit.network).toBe("Test SDF Network ; September 2015");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --filter @mutav/wallet test -- src/browser/__tests__/kit.test.ts
```

Expected: FAIL with `Cannot find module '../network'` and `Cannot find module '../kit'`.

- [ ] **Step 3: Implement `network.ts`**

Create `packages/wallet/src/browser/network.ts`:

```ts
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";
import type { Network } from "../types";

/**
 * Reads NEXT_PUBLIC_STELLAR_NETWORK from process.env. Throws on
 * missing or invalid value. See spec § Section 2 (Network selection).
 */
export function readNetwork(): Network {
  const value = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  if (value === undefined || value === "") {
    throw new Error(
      "NEXT_PUBLIC_STELLAR_NETWORK must be set to PUBLIC or TESTNET",
    );
  }
  if (value !== "PUBLIC" && value !== "TESTNET") {
    throw new Error(
      `NEXT_PUBLIC_STELLAR_NETWORK must be PUBLIC or TESTNET, got ${value}`,
    );
  }
  return value;
}

/**
 * Maps the @mutav/wallet `Network` type to the kit's `WalletNetwork` enum.
 */
export function toKitNetwork(network: Network): WalletNetwork {
  return network === "PUBLIC" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET;
}
```

- [ ] **Step 4: Implement `kit.ts`**

Create `packages/wallet/src/browser/kit.ts`:

```ts
import {
  StellarWalletsKit,
  FreighterModule,
  LobstrModule,
  xBullModule,
} from "@creit.tech/stellar-wallets-kit";
import { readNetwork, toKitNetwork } from "./network";

/**
 * Creates a StellarWalletsKit instance with the three explicit modules
 * spec § Section 2 commits to (Freighter, Lobstr, xBull). Critically:
 * NEVER uses `allowAllModules()` — see the custom ESLint rule
 * @mutav/wallet/no-allow-all-modules.
 */
export function createKit(): StellarWalletsKit {
  const network = readNetwork();
  return new StellarWalletsKit({
    network: toKitNetwork(network),
    modules: [
      new FreighterModule(),
      new LobstrModule(),
      new xBullModule(),
    ],
  });
}
```

- [ ] **Step 5: Create the browser barrel**

Create `packages/wallet/src/browser/index.ts`:

```ts
export { createKit } from "./kit";
export { readNetwork, toKitNetwork } from "./network";
export type { Network, WalletConnection, SigningResult } from "../types";
export { WalletError } from "../types";
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
bun --filter @mutav/wallet test -- src/browser/__tests__/kit.test.ts
```

Expected: all 6 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/wallet/src/browser/
git commit -m "feat(wallet): browser submodule — kit factory + network reader"
```

---

## Task 6: `MockKitModule` for tests

**Files:**
- Create: `packages/wallet/src/test/mock-kit-module.ts`
- Create: `packages/wallet/src/test/__tests__/mock-kit-module.test.ts`

- [ ] **Step 1: Write failing tests for the mock**

Create `packages/wallet/src/test/__tests__/mock-kit-module.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MockKitModule, type MockOptions } from "../mock-kit-module";

describe("MockKitModule", () => {
  it("returns the configured address on getAddress", async () => {
    const mock = new MockKitModule({ address: "GTESTADDRESS123" });
    const { address } = await mock.getAddress();
    expect(address).toBe("GTESTADDRESS123");
  });

  it("returns the configured signed XDR on signTransaction", async () => {
    const mock = new MockKitModule({
      address: "GTESTADDRESS123",
      signedXdr: "AAAA...SIGNED",
    });
    const { signedTxXdr } = await mock.signTransaction("AAAA...UNSIGNED", {
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    expect(signedTxXdr).toBe("AAAA...SIGNED");
  });

  it("throws WalletError USER_REJECTED when configured to reject", async () => {
    const mock = new MockKitModule({
      address: "G...",
      rejectOnSign: true,
    });
    await expect(
      mock.signTransaction("AAAA...UNSIGNED", {
        networkPassphrase: "Test SDF Network ; September 2015",
      }),
    ).rejects.toThrow("USER_REJECTED");
  });

  it("throws NETWORK_MISMATCH when wallet network differs from request", async () => {
    const mock = new MockKitModule({
      address: "G...",
      walletNetwork: "PUBLIC",
    });
    await expect(
      mock.signTransaction("AAAA...UNSIGNED", {
        networkPassphrase: "Test SDF Network ; September 2015", // TESTNET
      }),
    ).rejects.toThrow("NETWORK_MISMATCH");
  });
});

describe("MockKitModule.Options", () => {
  it("MockOptions type compiles with all optional fields", () => {
    const opts: MockOptions = { address: "G..." };
    expect(opts).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun --filter @mutav/wallet test -- src/test/__tests__/mock-kit-module.test.ts
```

Expected: FAIL with "Cannot find module '../mock-kit-module'".

- [ ] **Step 3: Implement `MockKitModule`**

Create `packages/wallet/src/test/mock-kit-module.ts`:

```ts
import { WalletError } from "../types";
import type { Network } from "../types";

export interface MockOptions {
  readonly address: string;
  readonly signedXdr?: string;
  readonly rejectOnSign?: boolean;
  readonly walletNetwork?: Network;
}

interface SignOptions {
  readonly networkPassphrase: string;
}

const PASSPHRASE: Record<Network, string> = {
  PUBLIC: "Public Global Stellar Network ; September 2015",
  TESTNET: "Test SDF Network ; September 2015",
};

/**
 * A test double implementing just enough of the Stellar Wallets Kit
 * Module interface to drive unit + integration tests. Configurable via
 * MockOptions; see the spec § Section 8 for the scenarios it covers.
 */
export class MockKitModule {
  readonly productId = "mock";
  readonly productName = "Mock Wallet";
  readonly productUrl = "https://example.test";
  readonly productIcon = "";

  private readonly options: MockOptions;

  constructor(options: MockOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getAddress(): Promise<{ address: string }> {
    return { address: this.options.address };
  }

  async signTransaction(
    xdr: string,
    options: SignOptions,
  ): Promise<{ signedTxXdr: string; signerAddress: string }> {
    if (this.options.rejectOnSign) {
      throw new WalletError(
        "USER_REJECTED",
        "Mock configured to reject signature",
      );
    }
    if (this.options.walletNetwork !== undefined) {
      const expectedPassphrase = PASSPHRASE[this.options.walletNetwork];
      if (options.networkPassphrase !== expectedPassphrase) {
        throw new WalletError(
          "NETWORK_MISMATCH",
          `Wallet on ${this.options.walletNetwork} but request used ${options.networkPassphrase}`,
        );
      }
    }
    const signedTxXdr = this.options.signedXdr ?? `${xdr}.MOCK-SIGNED`;
    return { signedTxXdr, signerAddress: this.options.address };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun --filter @mutav/wallet test -- src/test/__tests__/mock-kit-module.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet/src/test/
git commit -m "feat(wallet): MockKitModule for unit + integration tests"
```

---

## Task 7: Browser submodule — hooks (`useWallet`, `useConnect`, `useSignXdr`)

**Files:**
- Create: `packages/wallet/src/browser/use-wallet.tsx`
- Create: `packages/wallet/src/browser/use-connect.tsx`
- Create: `packages/wallet/src/browser/use-sign-xdr.tsx`
- Modify: `packages/wallet/src/browser/index.ts` (add hook exports)
- Create: `packages/wallet/src/browser/__tests__/hooks.test.tsx`

- [ ] **Step 1: Add testing-library dev deps**

```bash
bun add --filter @mutav/wallet --dev @testing-library/react@^16 @testing-library/dom@^10 happy-dom@^15
```

- [ ] **Step 2: Configure vitest env for the package**

Create `packages/wallet/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 3: Write failing tests for the hooks**

Create `packages/wallet/src/browser/__tests__/hooks.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useWallet, WalletProvider } from "../use-wallet";
import { useConnect } from "../use-connect";
import { useSignXdr } from "../use-sign-xdr";
import { MockKitModule } from "../../test/mock-kit-module";

function wrapper(mock: MockKitModule) {
  return ({ children }: { children: React.ReactNode }) => (
    <WalletProvider initialModule={mock}>{children}</WalletProvider>
  );
}

describe("useWallet", () => {
  it("returns no connection initially", () => {
    const mock = new MockKitModule({ address: "GAAAA" });
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapper(mock),
    });
    expect(result.current.connection).toBeNull();
  });
});

describe("useConnect", () => {
  it("connects via the configured module and exposes the address", async () => {
    const mock = new MockKitModule({ address: "GTEST" });
    const { result } = renderHook(
      () => ({ connect: useConnect(), wallet: useWallet() }),
      { wrapper: wrapper(mock) },
    );

    await act(async () => {
      await result.current.connect.connect();
    });

    expect(result.current.wallet.connection?.address).toBe("GTEST");
  });
});

describe("useSignXdr", () => {
  it("signs an XDR after connect and returns SigningResult", async () => {
    const mock = new MockKitModule({
      address: "GTEST",
      signedXdr: "AAAA.SIGNED.XDR",
    });
    const { result } = renderHook(
      () => ({ connect: useConnect(), sign: useSignXdr() }),
      { wrapper: wrapper(mock) },
    );

    await act(async () => {
      await result.current.connect.connect();
    });

    let signed;
    await act(async () => {
      signed = await result.current.sign.sign("AAAA.UNSIGNED");
    });
    expect(signed?.signedXdr).toBe("AAAA.SIGNED.XDR");
    expect(signed?.signerAddress).toBe("GTEST");
  });

  it("propagates USER_REJECTED as a WalletError", async () => {
    const mock = new MockKitModule({
      address: "GTEST",
      rejectOnSign: true,
    });
    const { result } = renderHook(
      () => ({ connect: useConnect(), sign: useSignXdr() }),
      { wrapper: wrapper(mock) },
    );

    await act(async () => {
      await result.current.connect.connect();
    });

    await expect(
      act(async () => {
        await result.current.sign.sign("AAAA.UNSIGNED");
      }),
    ).rejects.toThrow("USER_REJECTED");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
bun --filter @mutav/wallet test -- src/browser/__tests__/hooks.test.tsx
```

Expected: FAIL — modules don't exist yet.

- [ ] **Step 5: Implement `useWallet.tsx` with provider**

Create `packages/wallet/src/browser/use-wallet.tsx`:

```tsx
"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { WalletConnection } from "../types";

interface WalletState {
  connection: WalletConnection | null;
  setConnection: (next: WalletConnection | null) => void;
  module: unknown; // The kit module — typed loosely to support both real kit + MockKitModule
}

const WalletContext = createContext<WalletState | null>(null);

export interface WalletProviderProps {
  readonly children: ReactNode;
  /** The kit instance OR a MockKitModule. Tests pass the mock; production passes a kit. */
  readonly initialModule: unknown;
}

export function WalletProvider({
  children,
  initialModule,
}: WalletProviderProps) {
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const value = useMemo<WalletState>(
    () => ({ connection, setConnection, module: initialModule }),
    [connection, initialModule],
  );
  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (ctx === null) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return { connection: ctx.connection };
}

/**
 * Internal hook for hooks that need to mutate connection / read the module.
 * Not part of the public API.
 */
export function _useWalletInternals() {
  const ctx = useContext(WalletContext);
  if (ctx === null) {
    throw new Error("Internal hook used outside <WalletProvider>");
  }
  return ctx;
}
```

- [ ] **Step 6: Implement `useConnect.tsx`**

Create `packages/wallet/src/browser/use-connect.tsx`:

```tsx
"use client";

import { useCallback } from "react";
import { _useWalletInternals } from "./use-wallet";
import { readNetwork } from "./network";
import { WalletError, type WalletConnection } from "../types";

interface KitLike {
  getAddress: () => Promise<{ address: string }>;
}

export function useConnect() {
  const { setConnection, module } = _useWalletInternals();
  const network = readNetwork();

  const connect = useCallback(async () => {
    const kit = module as KitLike;
    try {
      const { address } = await kit.getAddress();
      const connection: WalletConnection = {
        address,
        network,
        transport: "browser-kit",
      };
      setConnection(connection);
      return connection;
    } catch (err) {
      if (err instanceof WalletError) throw err;
      throw new WalletError(
        "UNKNOWN",
        `connect failed: ${(err as Error).message ?? String(err)}`,
      );
    }
  }, [module, network, setConnection]);

  const disconnect = useCallback(() => {
    setConnection(null);
  }, [setConnection]);

  return { connect, disconnect };
}
```

- [ ] **Step 7: Implement `useSignXdr.tsx`**

Create `packages/wallet/src/browser/use-sign-xdr.tsx`:

```tsx
"use client";

import { useCallback } from "react";
import { _useWalletInternals } from "./use-wallet";
import { readNetwork, toKitNetwork } from "./network";
import { WalletError, type SigningResult } from "../types";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit";

interface KitLike {
  signTransaction: (
    xdr: string,
    options: { networkPassphrase: string },
  ) => Promise<{ signedTxXdr: string; signerAddress: string }>;
}

// Borrow the kit's passphrase mapping so the mock + real kit agree.
const PASSPHRASE: Record<WalletNetwork, string> = {
  [WalletNetwork.PUBLIC]: "Public Global Stellar Network ; September 2015",
  [WalletNetwork.TESTNET]: "Test SDF Network ; September 2015",
  [WalletNetwork.FUTURENET]: "Test SDF Future Network ; October 2022",
  [WalletNetwork.SANDBOX]: "Local Sandbox Stellar Network ; September 2022",
  [WalletNetwork.STANDALONE]: "Standalone Network ; February 2017",
};

export function useSignXdr() {
  const { connection, module } = _useWalletInternals();
  const network = readNetwork();

  const sign = useCallback(
    async (xdr: string): Promise<SigningResult> => {
      if (connection === null) {
        throw new WalletError("CONNECTION_LOST", "No wallet connected");
      }
      const kit = module as KitLike;
      const kitNetwork = toKitNetwork(network);
      const networkPassphrase = PASSPHRASE[kitNetwork];
      try {
        const { signedTxXdr, signerAddress } = await kit.signTransaction(xdr, {
          networkPassphrase,
        });
        return { signedXdr: signedTxXdr, signerAddress };
      } catch (err) {
        if (err instanceof WalletError) throw err;
        throw new WalletError(
          "UNKNOWN",
          `sign failed: ${(err as Error).message ?? String(err)}`,
        );
      }
    },
    [connection, module, network],
  );

  return { sign };
}
```

- [ ] **Step 8: Update the browser barrel**

Edit `packages/wallet/src/browser/index.ts` to add:

```ts
export { WalletProvider, useWallet } from "./use-wallet";
export { useConnect } from "./use-connect";
export { useSignXdr } from "./use-sign-xdr";
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
bun --filter @mutav/wallet test -- src/browser/__tests__/hooks.test.tsx
```

Expected: all 4 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/wallet/package.json packages/wallet/vitest.config.ts packages/wallet/src/browser/ packages/wallet/src/test/ bun.lock
git commit -m "feat(wallet): browser submodule — useWallet + useConnect + useSignXdr hooks"
```

---

## Task 8: Cross-app ESLint `no-restricted-paths` guard

**Files:**
- Modify: `eslint.config.mjs`

The spec § Section 6 requires that `apps/admin/**` cannot import from `@mutav/wallet/browser` or directly from `@creit.tech/stellar-wallets-kit`. Conversely, only `apps/admin/**` and `packages/wallet/src/ledger/**` may import from `@ledgerhq/*`. The ledger half doesn't exist yet (future Plan 2); add the rule that DOES apply now.

- [ ] **Step 1: Add the path rule to root `eslint.config.mjs`**

Locate the flat config entry that covers `apps/**` and add:

```js
{
  files: ["apps/admin/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@creit.tech/stellar-wallets-kit",
            message:
              "apps/admin uses @mutav/wallet/ledger only — browser-wallet kit is forbidden here. See spec § Section 6.",
          },
          {
            name: "@mutav/wallet/browser",
            message:
              "apps/admin uses @mutav/wallet/ledger only. See spec § Section 6.",
          },
        ],
        patterns: [
          {
            group: ["@creit.tech/stellar-wallets-kit/*"],
            message:
              "apps/admin uses @mutav/wallet/ledger only. See spec § Section 6.",
          },
        ],
      },
    ],
  },
},
```

> If there's already a `files: ["apps/admin/**/*"]` entry, merge into it instead of adding a duplicate.

- [ ] **Step 2: Verify lint passes**

```bash
bun run lint
```

Expected: exit `0`. `apps/admin/` has no imports of either path today.

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "feat(workspace): block browser-wallet imports from apps/admin (eslint no-restricted-imports)"
```

---

## Task 9: CI guards — `bun audit` + `dependency-review-action`

**Files:**
- Modify: `.github/workflows/quality.yml`
- Possibly create: `.github/workflows/dependency-review.yml`

- [ ] **Step 1: Inspect the existing quality.yml structure**

```bash
cat .github/workflows/quality.yml | head -40
```

Note the existing jobs and where to add a new step. Goal: a single `audit` job that runs `bun audit --severity=high` after install. Best to place it in the same workflow.

- [ ] **Step 2: Add the audit step**

Edit `.github/workflows/quality.yml`. Add a new job:

```yaml
  audit:
    name: bun audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.1
      - run: bun install --frozen-lockfile
      - run: bun audit --severity=high
```

> Set `--severity=high` rather than `critical` so even high-severity new vulns surface. Tune later if the noise is too high.

- [ ] **Step 3: Add the dependency-review job**

Add another job in the same workflow:

```yaml
  dependency-review:
    name: dependency-review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
```

- [ ] **Step 4: Validate YAML**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/quality.yml', 'utf8')); console.log('YAML OK')"
```

Expected: prints `YAML OK`. If `js-yaml` isn't available:

```bash
bunx --bun js-yaml < /dev/null > /dev/null 2>&1 || bun add --filter . --dev js-yaml --no-save 2>&1 | head -2
# Or just trust the structure and let CI validate it after push
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/quality.yml
git commit -m "ci(workspace): add bun audit + dependency-review-action gates"
```

---

## Task 10: Final regression sweep + PR description

**Files:** none (read-only verification + ops).

- [ ] **Step 1: Clean install**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
bun install
```

Expected: completes; `bun.lock` unchanged after install.

- [ ] **Step 2: Run every check**

```bash
bun run typecheck    > /tmp/walletkit-final-typecheck.log 2>&1; echo "typecheck=$?"
bun run lint         > /tmp/walletkit-final-lint.log 2>&1; echo "lint=$?"
bun run test         > /tmp/walletkit-final-test.log 2>&1; echo "test=$?"
bun run format:check > /tmp/walletkit-final-format.log 2>&1; echo "format=$?"
bun run build        > /tmp/walletkit-final-build.log 2>&1; echo "build=$?"
bunx tsc --noEmit --project convex/tsconfig.json > /tmp/walletkit-final-convex-tsc.log 2>&1; echo "convex-tsc=$?"
```

Expected: all six exit `0`.

- [ ] **Step 3: Run `bun audit` locally**

```bash
bun audit --severity=high
```

Expected: no high or critical CVEs reported. If any appear, **stop** and either downgrade or escalate.

- [ ] **Step 4: Verify the lint rule fires**

Create a temporary probe file `packages/wallet/_probe.ts` containing:

```ts
import { allowAllModules } from "@creit.tech/stellar-wallets-kit";
const x = allowAllModules();
```

Run:

```bash
bunx eslint packages/wallet/_probe.ts
```

Expected: 2 errors with the `no-allow-all-modules` message.

Delete the probe:

```bash
rm packages/wallet/_probe.ts
```

- [ ] **Step 5: Verify the path rule fires**

Create a temporary probe file `apps/admin/src/_probe.tsx` containing:

```tsx
import { createKit } from "@mutav/wallet/browser";
const k = createKit();
```

Run:

```bash
bunx eslint apps/admin/src/_probe.tsx
```

Expected: 1 error mentioning that browser-wallet kit is forbidden in apps/admin.

Delete the probe:

```bash
rm apps/admin/src/_probe.tsx
```

- [ ] **Step 6: Tree clean**

```bash
git status
```

Expected: "nothing to commit, working tree clean" (or only the pre-existing `apps/{pay,fund}/.gitignore` untracked files that predate this work).

- [ ] **Step 7: Push the branch**

```bash
git push -u origin docs/wallet-kit-selection-spec
```

> The spec already opened PR #157 against this branch. The new plan + implementation commits land on the same PR.

- [ ] **Step 8: Update the PR description**

```bash
gh pr edit 157 --repo mutav-finance/mutav-app --body-file - <<'EOF'
## Summary

Spec + Plan + Implementation for the **wallet-kit browser foundation**.

- **Spec**: [`docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md`](docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md) — picks the stacks for the three signing surfaces.
- **Plan**: [`docs/superpowers/plans/2026-06-01-wallet-kit-browser-foundation.md`](docs/superpowers/plans/2026-06-01-wallet-kit-browser-foundation.md) — this PR implements every task in it.
- **Implementation**: new `packages/wallet/` workspace package with browser submodule, custom ESLint rule, MockKitModule, CI audit guards.

## What's in this PR

| Area | Files |
|---|---|
| Spec + Plan docs | `docs/superpowers/specs/2026-06-01-wallet-kit-selection-design.md`, `docs/superpowers/plans/2026-06-01-wallet-kit-browser-foundation.md` |
| Package scaffold | `packages/wallet/{package.json,tsconfig.json,README.md,vitest.config.ts}` |
| Shared types | `packages/wallet/src/types.ts` |
| Browser submodule | `packages/wallet/src/browser/{kit.ts,network.ts,use-wallet.tsx,use-connect.tsx,use-sign-xdr.tsx,index.ts}` |
| Test infrastructure | `packages/wallet/src/test/mock-kit-module.ts` |
| Custom ESLint rule | `packages/wallet/src/lint/{no-allow-all-modules.ts,index.ts}` |
| Cross-cutting config | `eslint.config.mjs` (plugin registration + `no-restricted-imports` + `no-restricted-paths`) |
| CI guards | `.github/workflows/quality.yml` (bun audit + dependency-review-action) |

## What's NOT in this PR (per-spec deferrals)

- `@mutav/wallet/ledger` submodule — separate Plan 2 (admin HW wallet integration)
- Per-app wiring (`apps/fund`, `apps/agency`, `apps/admin`) — separate per-app specs per spec § Section 11
- Smart account / passkey / Wallet Standard / OZ Relayer — all v2 per spec § Section 9

## Verification

- `bun run typecheck` — exit 0
- `bun run lint` — exit 0
- `bun run test` — exit 0
- `bun run format:check` — exit 0
- `bun run build` — exit 0
- `bunx tsc --noEmit --project convex/tsconfig.json` — exit 0
- `bun audit --severity=high` — clean
- Lint rule fires on `allowAllModules` import + call (verified manually)
- Path rule fires on `apps/admin` importing browser kit (verified manually)

Refs #139 #157 mutav-finance/mutav-stellar#41.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 9: Stop**

Do not merge. The PR description now reflects everything that landed; wait for CI + human review.

---

## Final PR checklist

Before closing this task list:

- [ ] All 10 task commits land on `docs/wallet-kit-selection-spec` in order
- [ ] `bun.lock` updated cleanly (Stellar Wallets Kit, testing-library, happy-dom additions)
- [ ] No source file under `apps/*` modified except `eslint.config.mjs` cross-cutting rules
- [ ] No new high or critical CVE introduced (per `bun audit --severity=high`)
- [ ] PR description updated via Step 8 above
- [ ] Open follow-up: Plan 2 for `@mutav/wallet/ledger` submodule (admin HW wallet) — write after this PR merges

---

## What's next

After this PR merges, two parallel threads open:

1. **Plan 2 — `@mutav/wallet/ledger` submodule**: implements `@ledgerhq/hw-app-str` + WebHID transport + display-contract verification per spec § Section 3. Independent of any app wiring; can be written and implemented now.
2. **Per-app wiring specs**: `apps/fund` connect-wallet UX spec, `apps/agency` payment-signing spec, `apps/admin` HW-wallet flow spec. Each consumes the `@mutav/wallet` exports landing in this PR (and Plan 2's ledger submodule).

That's its own multi-task design effort and will be written after this PR merges.
