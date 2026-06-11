# Transparency Dashboard — Reserve Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the agency "health" surface to "transparency", and replace the fabricated treasury figure with a real, onchain-verifiable coverage number read from the deployed reserve-vault Soroban contract.

**Architecture:** Four PRs. (1) Mechanical rename `health → transparency` across route, components, i18n, and the Convex domain, with a redirect. (2) A new `convex/reserve/` bounded context: env getters, a `reserveSnapshots` table, domain types, and a pure stored-value calculator. (3) A Soroban-RPC action that reads the reserve vault's approved-asset balances and a cron that snapshots them. (4) Wire the transparency dashboard to the reserve snapshot, delete the mock treasury fetch, and fix the explorer-link / default-rate trust gaps.

**Tech Stack:** Next.js 16 (App Router) + next-intl, Convex (queries/mutations/actions/crons), `@stellar/stellar-sdk` ^15.1.0 (Soroban RPC), Vitest + convex-test, Tailwind 4 / shadcn.

**Onchain facts (locked):**
- Reserve vault (stage1 `reserve_vault`): `CBDGKVRP5MYER3I2WZ7F2FJULFFXY3NHB5MU75VSEZHDXYJNAB3YC7Y2` on **testnet**, alias `reserve-vault-postpivot`.
- Read interface (from `mutav-stellar/contracts/stage1/reserve_vault/src/lib.rs`): `approved_assets() -> Vec<Address>`, `balance(asset: Address) -> i128`, `paused() -> bool`, `admin() -> Address`. **No single `nav()`/`total_value()` getter** — stored value is summed per approved asset.
- Each approved asset is a SEP-41 token contract: read `symbol()` and `decimals()` from it to scale balances.
- The earlier hardcoded explorer link (`CAJTKYO…XWAJR`) is the **archived pre-pivot** deploy — wrong contract entirely.

**Naming (locked):** Convex/types/env use `reserve`; the user-facing pt-BR label is **"Reserva de cobertura"** (en: "Coverage reserve").

**Test commands:**
- Convex / agency tests: `bun --filter @mutav/agency test -- <substring>` (vitest `run`, filters by file path substring).
- Typecheck: `bun run typecheck`  ·  Lint: `bun run lint`  ·  Build: `bun --filter @mutav/agency build`.
- Convex `edge-runtime` tests must start with `// @vitest-environment edge-runtime`; pure tests default to `node`.

---

## File Structure

**Created**
- `convex/reserve/domain.ts` — `ReserveSnapshot`/`ReserveSnapshotId` aliases, `ReserveAsset`, `ReserveReadResult`, validators, and the pure `storedValueCentsFromAssets` / `rawBalanceToCents` calculators.
- `convex/reserve/useCases.ts` — `writeSnapshot` (internalMutation), `latestSnapshot` (internalQuery).
- `convex/reserve/actions.ts` — `refreshReserveSnapshot` (internalAction) + the Soroban-RPC read.
- `convex/reserve/domain.test.ts` — pure calculator tests (node).
- `convex/reserve/useCases.test.ts` — snapshot read/write tests (edge-runtime).
- `convex/transparency/useCases.test.ts` — `getReserveCoverage` query test (edge-runtime).
- `docs/superpowers/plans/2026-06-10-transparency-reserve-coverage.md` — this plan.

**Renamed (git mv, content-edited)**
- `convex/health/` → `convex/transparency/` (`domain.ts`, `useCases.ts`, `actions.ts`).
- `apps/agency/src/app/[locale]/(app)/health/` → `…/transparency/` (`page.tsx`, `loading.tsx`).
- `apps/agency/src/components/health/` → `…/transparency/` (`*-page.tsx`, four `*-panel.tsx`).

**Modified**
- `convex/schema.ts` — add `reserveSnapshots` table.
- `convex/lib/env.ts` — add `getReserveContractId`, `getStellarRpcUrl`, `getReserveBrlPeggedSymbols`.
- `convex/lib/env.test.ts` — getter tests.
- `convex/crons.ts` — add reserve snapshot interval.
- `apps/agency/src/components/app-sidebar.tsx` — route/label/icon.
- `apps/agency/next.config.ts` — `/health → /transparency` redirect.
- `apps/agency/messages/pt-BR.json`, `apps/agency/messages/en.json` — `health` namespace → `transparency`, new coverage keys.

---

## PR 1 — Rename `health` → `transparency`

Mechanical, no behavior change. Verification is grep + typecheck + build (no new unit tests).

### Task 1: Move the Convex domain folder

**Files:**
- Rename: `convex/health/{domain,useCases,actions}.ts` → `convex/transparency/{domain,useCases,actions}.ts`

- [ ] **Step 1: git mv the folder**

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
git mv convex/health convex/transparency
```

- [ ] **Step 2: Fix the cross-domain import comment in useCases**

In `convex/transparency/useCases.ts` the header comment says "transparency dashboard" already — leave it. No import path inside the folder references `health`, so nothing else changes here.

- [ ] **Step 3: Verify no stale internal references**

Run: `grep -rn "health" convex/transparency/`
Expected: no matches (the folder's own files never referenced `health/`).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "refactor(convex): rename health domain to transparency"
```

### Task 2: Repoint Convex imports + i18n namespace in the agency app

**Files:**
- Rename: `apps/agency/src/components/health/` → `apps/agency/src/components/transparency/`
- Rename: `apps/agency/src/app/[locale]/(app)/health/` → `…/(app)/transparency/`
- Modify: every moved file's `@convex/health/*` import and `useTranslations("health…")` call

- [ ] **Step 1: git mv both directories**

```bash
cd /Users/jubs/Projects/tga-protocol/mutav-app
git mv apps/agency/src/components/health apps/agency/src/components/transparency
git mv "apps/agency/src/app/[locale]/(app)/health" "apps/agency/src/app/[locale]/(app)/transparency"
```

- [ ] **Step 2: Rename the component symbol**

In `apps/agency/src/components/transparency/health-page.tsx`: rename the file to `transparency-page.tsx` and rename the exported `HealthPage` → `TransparencyPage`, `HealthPageLive` → `TransparencyPageLive`, `HealthPageLayout` → `TransparencyPageLayout`.

```bash
git mv apps/agency/src/components/transparency/health-page.tsx apps/agency/src/components/transparency/transparency-page.tsx
```

- [ ] **Step 3: Update every `@convex/health` import and `health.*` namespace string**

Edit these files, replacing `@convex/health/` → `@convex/transparency/`, `"health"` → `"transparency"`, `"health.contracts"` → `"transparency.contracts"`, etc., and `i18nNamespace="health.timeline"` → `"transparency.timeline"`:
- `apps/agency/src/app/[locale]/(app)/transparency/page.tsx` (also `import { HealthPage }` → `import { TransparencyPage } from "@/components/transparency/transparency-page"`)
- `apps/agency/src/app/[locale]/(app)/transparency/loading.tsx`
- `apps/agency/src/components/transparency/transparency-page.tsx`
- `apps/agency/src/components/transparency/contracts-panel.tsx`
- `apps/agency/src/components/transparency/capacity-panel.tsx`
- `apps/agency/src/components/transparency/treasury-panel.tsx`
- `apps/agency/src/components/transparency/timeline-panel.tsx`

- [ ] **Step 4: Verify no stale `health` references remain in the app**

Run: `grep -rn "health" apps/agency/src --include="*.ts" --include="*.tsx"`
Expected: no matches. (If any remain, fix them.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(agency): rename health route+components to transparency"
```

### Task 3: Rename the i18n namespace

**Files:**
- Modify: `apps/agency/messages/pt-BR.json`, `apps/agency/messages/en.json`

- [ ] **Step 1: Rename the top-level key**

In both files, rename the `"health"` object key to `"transparency"`, keeping all nested keys (`meta`, `heading`, `subheading`, `footer`, `contracts`, `capacity`, `treasury`, `timeline`) unchanged for now.

- [ ] **Step 2: Verify both files parse and the key moved**

Run: `node -e "const a=require('./apps/agency/messages/pt-BR.json'),b=require('./apps/agency/messages/en.json'); if(a.health||b.health) throw new Error('health key still present'); if(!a.transparency||!b.transparency) throw new Error('transparency key missing'); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "i18n(agency): rename health namespace to transparency"
```

### Task 4: Sidebar entry + route redirect

**Files:**
- Modify: `apps/agency/src/components/app-sidebar.tsx:30`
- Modify: `apps/agency/next.config.ts`

- [ ] **Step 1: Update the sidebar nav item**

In `apps/agency/src/components/app-sidebar.tsx`, change the health entry:

```tsx
{ title: tMain("transparency"), href: "/transparency", icon: <ShieldCheckIcon /> },
```

And update the lucide import: replace `HeartPulseIcon` with `ShieldCheckIcon` in the import statement at the top of the file. Then in both message files rename `nav.main.health` → `nav.main.transparency` (value stays "Transparência" / "Transparency").

- [ ] **Step 2: Add the redirect**

In `apps/agency/next.config.ts`, add a `redirects` function to the `NextConfig` object (before `withNextIntl` wraps it). Covers the unprefixed default-locale path and the `/en/` prefixed path:

```ts
const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: "/health", destination: "/transparency", permanent: true },
      { source: "/en/health", destination: "/en/transparency", permanent: true },
    ];
  },
  // ...existing config (headers, etc.)
};
```

(If the file currently exports an inline object into `withNextIntl(...)`, lift it to a named `nextConfig` const first, then `export default withNextIntl(nextConfig)`.)

- [ ] **Step 3: Verify typecheck + build**

Run: `bun run typecheck`
Expected: no errors.
Run: `bun --filter @mutav/agency build`
Expected: build succeeds; route list shows `/transparency`, not `/health`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(agency): transparency sidebar entry + /health redirect"
```

---

## PR 2 — `reserve` domain foundation (env, schema, pure calc)

### Task 5: Env getters for the reserve vault + Soroban RPC

**Files:**
- Modify: `convex/lib/env.ts`
- Test: `convex/lib/env.test.ts`

- [ ] **Step 1: Write failing getter tests**

Append to `convex/lib/env.test.ts`:

```ts
import { getReserveContractId, getStellarRpcUrl, getReserveBrlPeggedSymbols } from "./env";

describe("getReserveContractId", () => {
  const KEY = "STELLAR_RESERVE_CONTRACT_ID";
  const NET = "STELLAR_NETWORK";
  let origId: string | undefined;
  let origNet: string | undefined;
  beforeEach(() => {
    origId = process.env[KEY];
    origNet = process.env[NET];
  });
  afterEach(() => {
    if (origId === undefined) delete process.env[KEY];
    else process.env[KEY] = origId;
    if (origNet === undefined) delete process.env[NET];
    else process.env[NET] = origNet;
  });

  test("returns the explicit value when set", () => {
    process.env[KEY] = "CXYZ";
    expect(getReserveContractId()).toBe("CXYZ");
  });

  test("falls back to the testnet reserve vault when unset on testnet", () => {
    delete process.env[KEY];
    delete process.env[NET];
    expect(getReserveContractId()).toBe(
      "CBDGKVRP5MYER3I2WZ7F2FJULFFXY3NHB5MU75VSEZHDXYJNAB3YC7Y2",
    );
  });

  test("returns null on public network when unset (no mainnet default)", () => {
    delete process.env[KEY];
    process.env[NET] = "public";
    expect(getReserveContractId()).toBeNull();
  });
});

describe("getReserveBrlPeggedSymbols", () => {
  const KEY = "STELLAR_RESERVE_BRL_SYMBOLS";
  let orig: string | undefined;
  beforeEach(() => { orig = process.env[KEY]; });
  afterEach(() => { if (orig === undefined) delete process.env[KEY]; else process.env[KEY] = orig; });

  test("defaults to the BRL-pegged symbol set", () => {
    delete process.env[KEY];
    expect(getReserveBrlPeggedSymbols()).toEqual(["BRLT", "BRL", "TBRL"]);
  });

  test("parses a comma-separated override", () => {
    process.env[KEY] = "BRLX, FOO ,BAR";
    expect(getReserveBrlPeggedSymbols()).toEqual(["BRLX", "FOO", "BAR"]);
  });
});

describe("getStellarRpcUrl", () => {
  const URLK = "STELLAR_SOROBAN_RPC_URL";
  const NET = "STELLAR_NETWORK";
  let origUrl: string | undefined;
  let origNet: string | undefined;
  beforeEach(() => { origUrl = process.env[URLK]; origNet = process.env[NET]; });
  afterEach(() => {
    if (origUrl === undefined) delete process.env[URLK]; else process.env[URLK] = origUrl;
    if (origNet === undefined) delete process.env[NET]; else process.env[NET] = origNet;
  });

  test("defaults to testnet Soroban RPC", () => {
    delete process.env[URLK];
    delete process.env[NET];
    expect(getStellarRpcUrl()).toBe("https://soroban-testnet.stellar.org");
  });

  test("respects an explicit override", () => {
    process.env[URLK] = "https://my-rpc.example";
    expect(getStellarRpcUrl()).toBe("https://my-rpc.example");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun --filter @mutav/agency test -- lib/env`
Expected: FAIL — `getReserveContractId is not a function` (and siblings).

- [ ] **Step 3: Implement the getters**

In `convex/lib/env.ts`, near the existing Stellar block (after `getStellarHorizonUrl`), add:

```ts
const DEFAULT_RESERVE_VAULT_TESTNET = "CBDGKVRP5MYER3I2WZ7F2FJULFFXY3NHB5MU75VSEZHDXYJNAB3YC7Y2";
const DEFAULT_SOROBAN_RPC_TESTNET = "https://soroban-testnet.stellar.org";
const DEFAULT_SOROBAN_RPC_PUBLIC = "https://mainnet.sorobanrpc.com";

/**
 * Reserve-vault contract id. On testnet, defaults to the deployed
 * `reserve-vault-postpivot` instance so dev/preview reads work out of the box.
 * On `public` there is no default — returns `null` until explicitly configured,
 * and the reserve read reports `available: false` rather than guessing.
 */
export function getReserveContractId(): string | null {
  const explicit = process.env.STELLAR_RESERVE_CONTRACT_ID; // hook-ok: env module boundary
  if (explicit) return explicit;
  return getStellarNetwork() === "public" ? null : DEFAULT_RESERVE_VAULT_TESTNET;
}

/** Soroban RPC endpoint (distinct from Horizon). */
export function getStellarRpcUrl(): string {
  const explicit = process.env.STELLAR_SOROBAN_RPC_URL; // hook-ok: env module boundary
  if (explicit) return explicit;
  return getStellarNetwork() === "public" ? DEFAULT_SOROBAN_RPC_PUBLIC : DEFAULT_SOROBAN_RPC_TESTNET;
}

/**
 * SEP-41 symbols treated as 1:1 BRL for the coverage headline. Assets outside
 * this set still appear in the snapshot for transparency but don't contribute
 * to the cents total (no price feed in v1).
 */
export function getReserveBrlPeggedSymbols(): readonly string[] {
  const raw = process.env.STELLAR_RESERVE_BRL_SYMBOLS; // hook-ok: env module boundary
  if (raw) return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return ["BRLT", "BRL", "TBRL"];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun --filter @mutav/agency test -- lib/env`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(convex): reserve vault + soroban rpc env getters"
```

### Task 6: `reserveSnapshots` schema table

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the table**

In `convex/schema.ts`, inside the `defineSchema({ ... })` table map, add:

```ts
  reserveSnapshots: defineTable({
    storedValueCents: v.number(),
    assets: v.array(
      v.object({
        contractAddress: v.string(),
        symbol: v.string(),
        decimals: v.number(),
        rawBalance: v.string(),
      }),
    ),
    capturedAt: v.number(),
  }).index("by_capturedAt", ["capturedAt"]),
```

- [ ] **Step 2: Verify schema typechecks / codegen accepts it**

Run: `bun run typecheck`
Expected: no errors (the new table flows into `_generated/dataModel`).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(convex): reserveSnapshots table"
```

### Task 7: Reserve domain types + pure stored-value calculator

**Files:**
- Create: `convex/reserve/domain.ts`
- Test: `convex/reserve/domain.test.ts`

- [ ] **Step 1: Write failing calculator tests**

Create `convex/reserve/domain.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { rawBalanceToCents, storedValueCentsFromAssets, type ReserveAsset } from "./domain";

describe("rawBalanceToCents", () => {
  test("scales a 7-decimal balance to cents", () => {
    // 12345000000 / 10^7 = 1234.5 units -> 123450 cents
    expect(rawBalanceToCents("12345000000", 7)).toBe(123450);
  });

  test("rounds half up", () => {
    // 15 / 10^2 = 0.15 units -> 15 cents; 1 / 10^2 = 0.01 -> 1 cent
    expect(rawBalanceToCents("1", 2)).toBe(1);
    // 5 / 10^3 = 0.005 units -> 0.5 cents -> rounds to 1
    expect(rawBalanceToCents("5", 3)).toBe(1);
  });

  test("handles zero and large i128 values without float drift", () => {
    expect(rawBalanceToCents("0", 7)).toBe(0);
    expect(rawBalanceToCents("100000000000000", 7)).toBe(1000000000); // 10,000,000.00
  });
});

describe("storedValueCentsFromAssets", () => {
  const assets: ReserveAsset[] = [
    { contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "12345000000" }, // 1234.50
    { contractAddress: "C2", symbol: "USDC", decimals: 7, rawBalance: "50000000" }, // 5.00 USDC (ignored)
    { contractAddress: "C3", symbol: "BRL", decimals: 2, rawBalance: "10000" }, // 100.00
  ];

  test("sums only BRL-pegged symbols", () => {
    expect(storedValueCentsFromAssets(assets, ["BRLT", "BRL"])).toBe(123450 + 10000);
  });

  test("returns 0 when no asset is pegged", () => {
    expect(storedValueCentsFromAssets(assets, ["NONE"])).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun --filter @mutav/agency test -- reserve/domain`
Expected: FAIL — cannot find module `./domain`.

- [ ] **Step 3: Implement `convex/reserve/domain.ts`**

```ts
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export type ReserveSnapshot = Doc<"reserveSnapshots">;
export type ReserveSnapshotId = Id<"reserveSnapshots">;

/** One approved asset held by the reserve vault, as read from chain. */
export type ReserveAsset = {
  contractAddress: string; // SEP-41 token contract id (C...)
  symbol: string; // SEP-41 symbol(), e.g. "BRLT"
  decimals: number; // SEP-41 decimals()
  rawBalance: string; // i128 balance() as an unscaled base-10 string
};

/**
 * Outcome of a reserve read. NEVER a mock: when the contract is unconfigured
 * or the RPC read fails, `available` is false and the dashboard shows no number.
 */
export type ReserveReadResult =
  | { available: true; storedValueCents: number; assets: ReserveAsset[] }
  | { available: false };

export const reserveAssetValidator = v.object({
  contractAddress: v.string(),
  symbol: v.string(),
  decimals: v.number(),
  rawBalance: v.string(),
});

/**
 * Convert an unscaled i128 balance string + token decimals into BRL cents.
 * Pure integer math (BigInt) to avoid float drift on large i128 values.
 * Rounds half up.
 */
export function rawBalanceToCents(rawBalance: string, decimals: number): number {
  const negative = rawBalance.startsWith("-");
  const digits = negative ? rawBalance.slice(1) : rawBalance;
  const raw = BigInt(digits.length ? digits : "0");
  const scale = 10n ** BigInt(decimals);
  const centsScaled = raw * 100n;
  const whole = centsScaled / scale;
  const remainder = centsScaled % scale;
  const rounded = remainder * 2n >= scale ? whole + 1n : whole;
  const result = Number(rounded);
  return negative ? -result : result;
}

/**
 * Sum the BRL-pegged approved assets into integer cents. Non-pegged assets are
 * ignored in the headline (no price feed in v1) but remain in the snapshot.
 */
export function storedValueCentsFromAssets(
  assets: ReserveAsset[],
  brlPeggedSymbols: readonly string[],
): number {
  const pegged = new Set(brlPeggedSymbols);
  return assets.reduce(
    (cents, asset) =>
      pegged.has(asset.symbol) ? cents + rawBalanceToCents(asset.rawBalance, asset.decimals) : cents,
    0,
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `bun --filter @mutav/agency test -- reserve/domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(convex): reserve domain types + stored-value calculator"
```

---

## PR 3 — Reserve onchain read + snapshot cron

### Task 8: Snapshot read/write use cases

**Files:**
- Create: `convex/reserve/useCases.ts`
- Test: `convex/reserve/useCases.test.ts`

- [ ] **Step 1: Write failing read/write test**

Create `convex/reserve/useCases.test.ts`:

```ts
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";

describe("reserve snapshots", () => {
  test("latestSnapshot returns null when none exist", async () => {
    const t = convexTest(schema);
    const latest = await t.query(internal.reserve.useCases.latestSnapshot, {});
    expect(latest).toBeNull();
  });

  test("writeSnapshot inserts and latestSnapshot returns the newest by capturedAt", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 100,
      assets: [{ contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "1000000000" }],
      capturedAt: 1000,
    });
    await t.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 250,
      assets: [{ contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "2500000000" }],
      capturedAt: 2000,
    });
    const latest = await t.query(internal.reserve.useCases.latestSnapshot, {});
    expect(latest?.storedValueCents).toBe(250);
    expect(latest?.capturedAt).toBe(2000);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun --filter @mutav/agency test -- reserve/useCases`
Expected: FAIL — `internal.reserve.useCases` is undefined.

- [ ] **Step 3: Implement `convex/reserve/useCases.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { reserveAssetValidator, type ReserveSnapshot } from "./domain";

export const writeSnapshot = internalMutation({
  args: {
    storedValueCents: v.number(),
    assets: v.array(reserveAssetValidator),
    capturedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reserveSnapshots", args);
  },
});

export const latestSnapshot = internalQuery({
  args: {},
  handler: async (ctx): Promise<ReserveSnapshot | null> => {
    return await ctx.db.query("reserveSnapshots").withIndex("by_capturedAt").order("desc").first();
  },
});
```

- [ ] **Step 4: Run to verify pass**

Run: `bun --filter @mutav/agency test -- reserve/useCases`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(convex): reserve snapshot read/write use cases"
```

### Task 9: Soroban-RPC reserve read action

**Files:**
- Create: `convex/reserve/actions.ts`

> No unit test: this action makes live network calls. It is verified by a manual testnet read (Step 4) and by typecheck/lint. The pure math it depends on is already covered in Task 7.

- [ ] **Step 1: Implement `convex/reserve/actions.ts`**

```ts
"use node";

import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  type xdr,
} from "@stellar/stellar-sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  getReserveBrlPeggedSymbols,
  getReserveContractId,
  getStellarNetwork,
  getStellarRpcUrl,
} from "../lib/env";
import { storedValueCentsFromAssets, type ReserveAsset, type ReserveReadResult } from "./domain";

// Canonical all-zero account — valid for read-only simulation (never signed).
const SIMULATION_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

async function simulateRead(
  server: rpc.Server,
  contract: Contract,
  method: string,
  args: xdr.ScVal[],
  networkPassphrase: string,
): Promise<unknown> {
  const source = new Account(SIMULATION_SOURCE, "0");
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  if (!sim.result?.retval) throw new Error(`${method}: empty retval`);
  return scValToNative(sim.result.retval);
}

async function readReserve(): Promise<ReserveReadResult> {
  const contractId = getReserveContractId();
  if (!contractId) return { available: false };

  try {
    const server = new rpc.Server(getStellarRpcUrl());
    const networkPassphrase =
      getStellarNetwork() === "public" ? Networks.PUBLIC : Networks.TESTNET;
    const vault = new Contract(contractId);

    const addresses = (await simulateRead(
      server,
      vault,
      "approved_assets",
      [],
      networkPassphrase,
    )) as string[];

    const assets: ReserveAsset[] = [];
    for (const addr of addresses) {
      const token = new Contract(addr);
      const [rawBalance, symbol, decimals] = await Promise.all([
        simulateRead(server, vault, "balance", [Address.fromString(addr).toScVal()], networkPassphrase),
        simulateRead(server, token, "symbol", [], networkPassphrase),
        simulateRead(server, token, "decimals", [], networkPassphrase),
      ]);
      assets.push({
        contractAddress: addr,
        symbol: String(symbol),
        decimals: Number(decimals),
        rawBalance: String(rawBalance),
      });
    }

    const storedValueCents = storedValueCentsFromAssets(assets, getReserveBrlPeggedSymbols());
    return { available: true, storedValueCents, assets };
  } catch {
    // RPC unreachable / contract not readable — report unavailable, never a mock.
    return { available: false };
  }
}

export const refreshReserveSnapshot = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const result = await readReserve();
    if (!result.available) return; // keep the last good snapshot; write nothing
    await ctx.runMutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: result.storedValueCents,
      assets: result.assets,
      capturedAt: Date.now(),
    });
  },
});
```

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck`
Expected: no errors.
Run: `bun run lint`
Expected: no new violations (note: the `"use node"` action is allowed direct `@stellar/stellar-sdk` imports; the env reads stay behind `convex/lib/env.ts`).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(convex): reserve vault soroban read action"
```

- [ ] **Step 4: Manual testnet verification**

Run the action against the live contract and confirm a snapshot row is written:

Run: `bunx convex run reserve/actions:refreshReserveSnapshot '{}'`
Then: `bunx convex run reserve/useCases:latestSnapshot '{}'`
Expected: a JSON snapshot with `storedValueCents`, an `assets` array (each with `symbol`/`decimals`/`rawBalance`), and a `capturedAt`. If the vault currently holds no approved BRL-pegged asset, `storedValueCents` is `0` with an `assets` array reflecting what's held — that is correct, not a failure. If the result is `null`, inspect the action logs (`bunx convex logs`) to see whether the RPC read threw.

### Task 10: Schedule the snapshot refresh cron

**Files:**
- Modify: `convex/crons.ts`

- [ ] **Step 1: Add the interval**

In `convex/crons.ts`, after the existing schedules and before `export default crons;`, add:

```ts
/**
 * Every 15 minutes. Reads the reserve vault's approved-asset balances over
 * Soroban RPC and writes a `reserveSnapshots` row. On read failure it writes
 * nothing, so the dashboard keeps the last good (timestamped) figure.
 */
crons.interval(
  "refresh reserve snapshot",
  { minutes: 15 },
  internal.reserve.actions.refreshReserveSnapshot,
  {},
);
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: no errors (`internal.reserve.actions.refreshReserveSnapshot` resolves).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(convex): cron to snapshot reserve coverage every 15m"
```

---

## PR 4 — Wire the dashboard + kill the trust gaps

### Task 11: `getReserveCoverage` transparency query

**Files:**
- Modify: `convex/transparency/domain.ts` (add `ReserveCoverage` type)
- Modify: `convex/transparency/useCases.ts` (add the query)
- Test: `convex/transparency/useCases.test.ts`

- [ ] **Step 1: Add the `ReserveCoverage` type**

In `convex/transparency/domain.ts`, append:

```ts
export type ReserveCoverage = { explorerUrl: string } & (
  | { available: true; storedValueCents: number; capturedAt: number; assetCount: number }
  | { available: false }
);
```

- [ ] **Step 2: Write the failing query test**

Create `convex/transparency/useCases.test.ts`:

```ts
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

describe("getReserveCoverage", () => {
  test("reports unavailable (but with an explorer url) when no snapshot exists", async () => {
    const t = convexTest(schema);
    const coverage = await t.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(false);
    expect(typeof coverage.explorerUrl).toBe("string");
    expect(coverage.explorerUrl).toContain("/contract/");
  });

  test("returns the latest snapshot when one exists", async () => {
    const t = convexTest(schema);
    await t.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 50784300,
      assets: [{ contractAddress: "C1", symbol: "BRLT", decimals: 7, rawBalance: "5078430000000" }],
      capturedAt: 1717000000000,
    });
    const coverage = await t.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(true);
    if (coverage.available) {
      expect(coverage.storedValueCents).toBe(50784300);
      expect(coverage.capturedAt).toBe(1717000000000);
      expect(coverage.assetCount).toBe(1);
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun --filter @mutav/agency test -- transparency/useCases`
Expected: FAIL — `getReserveCoverage` is undefined.

- [ ] **Step 4: Implement the query**

In `convex/transparency/useCases.ts`, add the import and handler. Reuse the existing `queryWithAuth` import already present in the file (the platform-aggregates query uses it):

```ts
import { getReserveContractId, getStellarNetwork } from "../lib/env";
import type { ReserveCoverage } from "./domain";

function reserveExplorerUrl(): string {
  const id = getReserveContractId();
  const network = getStellarNetwork() === "public" ? "public" : "testnet";
  // When unconfigured (mainnet, no id) link to the network's contract index root.
  return id
    ? `https://stellar.expert/explorer/${network}/contract/${id}`
    : `https://stellar.expert/explorer/${network}`;
}

// Platform-wide BY DESIGN — every viewer sees the same onchain coverage figure.
export const getReserveCoverage = queryWithAuth({
  args: {},
  handler: async (ctx): Promise<ReserveCoverage> => {
    const explorerUrl = reserveExplorerUrl();
    const snap = await ctx.db
      .query("reserveSnapshots")
      .withIndex("by_capturedAt")
      .order("desc")
      .first();
    if (!snap) return { explorerUrl, available: false };
    return {
      explorerUrl,
      available: true,
      storedValueCents: snap.storedValueCents,
      capturedAt: snap.capturedAt,
      assetCount: snap.assets.length,
    };
  },
});
```

- [ ] **Step 5: Run to verify pass**

Run: `bun --filter @mutav/agency test -- transparency/useCases`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(convex): getReserveCoverage transparency query"
```

### Task 12: Replace the Treasury panel with a Reserve coverage panel

**Files:**
- Create: `apps/agency/src/components/transparency/reserve-panel.tsx`
- Delete: `apps/agency/src/components/transparency/treasury-panel.tsx`
- Delete: `convex/transparency/actions.ts` (the old mock-treasury Horizon read)
- Modify: `apps/agency/src/components/transparency/transparency-page.tsx`
- Modify: `apps/agency/src/app/[locale]/(app)/transparency/page.tsx`

- [ ] **Step 1: Create the reserve panel**

`apps/agency/src/components/transparency/reserve-panel.tsx` — renders from the preloaded coverage query; shows an explicit "Indisponível" state (never a fabricated number) and an "as of" timestamp, and links to the correct, network-aware contract explorer:

```tsx
"use client";

import { useTranslations, useLocale } from "next-intl";
import { ExternalLinkIcon, ShieldCheckIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@mutav/ui/skeleton";
import type { ReserveCoverage } from "@convex/transparency/domain";

type Props = { coverage: ReserveCoverage | null | undefined };

export function ReservePanel({ coverage }: Props) {
  const t = useTranslations("transparency.reserve");
  const locale = useLocale();
  const loading = coverage === null || coverage === undefined;

  const asOf =
    coverage?.available && coverage.capturedAt
      ? new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(
          new Date(coverage.capturedAt),
        )
      : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <ShieldCheckIcon className="size-3.5" />
          {t("label")}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">
          {loading ? (
            <Skeleton className="h-8 w-28" />
          ) : coverage.available ? (
            Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(
              coverage.storedValueCents / 100,
            )
          ) : (
            <span className="text-muted-foreground text-base">{t("unavailable")}</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <div className="flex flex-col gap-1.5">
            {asOf ? (
              <span className="text-muted-foreground text-xs">{t("asOf", { datetime: asOf })}</span>
            ) : null}
            <a
              href={coverage.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary flex items-center gap-1 text-xs font-medium hover:underline"
            >
              {t("viewExplorer")}
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Delete the treasury panel and the mock action**

```bash
git rm apps/agency/src/components/transparency/treasury-panel.tsx
git rm convex/transparency/actions.ts
```

Also remove `TreasurySnapshot` from `convex/transparency/domain.ts` (no longer used).

- [ ] **Step 3: Rewire the page shell**

In `apps/agency/src/components/transparency/transparency-page.tsx`:
- Remove the `useAction`/`getTreasurySnapshot` import, the `treasury`/`treasuryError` state, the `loadTreasury` effect event, and the `useEffect`.
- Replace the `<TreasuryPanel .../>` usage with `<ReservePanel coverage={coverage} />`.
- Thread a new `preloadedCoverage` / `initialCoverage` prop through the same Live/Layout split used for aggregates. Concretely, add to `Props`, `LiveProps`, and `LayoutProps`:

```ts
// Props
preloadedCoverage: Preloaded<typeof api.transparency.useCases.getReserveCoverage> | null;
initialCoverage: ReserveCoverage | null;
// LiveProps
preloadedCoverage: Preloaded<typeof api.transparency.useCases.getReserveCoverage>;
// LayoutProps
coverage: ReserveCoverage | null | undefined;
```

In `TransparencyPageLive`, add `const coverage = usePreloadedQuery(preloadedCoverage);` and pass it down. In the non-preloaded fallback branch, pass `initialCoverage`. Import `ReservePanel` from `./reserve-panel` and `ReserveCoverage` from `@convex/transparency/domain`.

- [ ] **Step 4: Preload the coverage query in the route**

In `apps/agency/src/app/[locale]/(app)/transparency/page.tsx`, add a third `preloadQuery` for `api.transparency.useCases.getReserveCoverage` inside the existing `Promise.all`, mirror the `preloadedQueryResult` extraction into an `initialCoverage` variable, and pass `preloadedCoverage` / `initialCoverage` to `<TransparencyPage />`.

- [ ] **Step 5: Typecheck + build**

Run: `bun run typecheck`
Expected: no errors.
Run: `bun --filter @mutav/agency build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(agency): reserve coverage panel from onchain snapshot; drop mock treasury"
```

### Task 13: Fix the default-rate + capacity trust gaps

**Files:**
- Modify: `convex/transparency/domain.ts` (`ContractAggregates.defaultRate`)
- Modify: `convex/transparency/useCases.ts` (`getContractAggregates`)
- Modify: `apps/agency/src/components/transparency/contracts-panel.tsx`
- Modify: `apps/agency/messages/pt-BR.json`, `apps/agency/messages/en.json`

- [ ] **Step 1: Make `defaultRate` explicitly absent, not a fake 0**

In `convex/transparency/domain.ts`, change the field type:

```ts
defaultRate: number | null;
```

In `convex/transparency/useCases.ts` `getContractAggregates`, return `defaultRate: null` (drop the `const defaultRate = 0` and its comment, replacing with a short note that default tracking is unimplemented):

```ts
// No `inadimplente` contract state exists yet — expose null so the UI shows
// "—" instead of a misleading 0% on a transparency surface.
return {
  countAtivos: countAtivos ?? 0,
  countPendentes: countPendentes ?? 0,
  sumInsuredCents,
  defaultRate: null,
  maxCapacityCents: getMaxGuaranteeCapacityCents(),
};
```

- [ ] **Step 2: Render the absent state in the contracts panel**

In `apps/agency/src/components/transparency/contracts-panel.tsx`, replace the `defaultRatePct` derivation:

```tsx
const defaultRatePct =
  aggregates && aggregates.defaultRate !== null ? `${(aggregates.defaultRate * 100).toFixed(1)}%` : "—";
```

- [ ] **Step 3: Clarify the capacity label**

In both message files, under `transparency.capacity`, change `label` to make clear the denominator is a configured cap (so utilization isn't misread as a live fund ratio):

pt-BR: `"label": "Utilização da capacidade contratada"`
en: `"label": "Contracted capacity utilization"`

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "fix(transparency): null default-rate + honest capacity label"
```

### Task 14: i18n keys for the reserve panel + footer

**Files:**
- Modify: `apps/agency/messages/pt-BR.json`, `apps/agency/messages/en.json`

- [ ] **Step 1: Replace the `treasury` namespace with `reserve` and update the footer**

Under `transparency`, remove the old `treasury` object and add (pt-BR):

```json
"reserve": {
  "label": "Reserva de cobertura",
  "unavailable": "Indisponível",
  "asOf": "Atualizado em {datetime}",
  "viewExplorer": "Verificar na rede Stellar"
},
```

And update the `footer` to distinguish live contract data from the periodic onchain snapshot:

pt-BR: `"footer": "Dados de contratos em tempo real. Reserva de cobertura lida onchain e atualizada periodicamente."`

Mirror in `en.json`:

```json
"reserve": {
  "label": "Coverage reserve",
  "unavailable": "Unavailable",
  "asOf": "As of {datetime}",
  "viewExplorer": "Verify on the Stellar network"
},
```

en footer: `"footer": "Contract data in real time. Coverage reserve read onchain and refreshed periodically."`

- [ ] **Step 2: Verify both locales have matching reserve keys and no leftover treasury keys**

Run: `node -e "const a=require('./apps/agency/messages/pt-BR.json'),b=require('./apps/agency/messages/en.json'); const ak=Object.keys(a.transparency.reserve).sort().join(','), bk=Object.keys(b.transparency.reserve).sort().join(','); if(ak!==bk) throw new Error('reserve keys differ: '+ak+' vs '+bk); if(a.transparency.treasury||b.transparency.treasury) throw new Error('treasury keys still present'); console.log('ok', ak)"`
Expected: `ok asOf,label,unavailable,viewExplorer`

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "i18n(agency): reserve coverage strings + clarified footer"
```

### Task 15: Full verification pass

- [ ] **Step 1: Run the whole agency + convex suite**

Run: `bun --filter @mutav/agency test`
Expected: all tests pass (includes the new `reserve/*` and `transparency/*` tests).

- [ ] **Step 2: Typecheck + lint + build**

Run: `bun run typecheck && bun run lint && bun --filter @mutav/agency build`
Expected: all succeed.

- [ ] **Step 3: Confirm no `health` / mock / hardcoded-contract residue**

Run: `grep -rn "HeartPulse\|getTreasurySnapshot\|CAJTKYO\|50_784_300\|XLM_BRL_APPROX" apps/agency/src convex || echo "clean"`
Expected: `clean`.
Run: `grep -rn "\"health\"\|'health'\|/health\|@convex/health\|components/health" apps/agency/src convex || echo "clean"`
Expected: `clean` (the only allowed `/health` reference is the redirect *source* in `next.config.ts`, which this grep does not scan).

- [ ] **Step 4: Manual smoke**

Start the app (`bun run dev`), visit `/transparency`:
- The coverage tile shows a BRL figure with an "Atualizado em …" line once the cron (or a manual `bunx convex run reserve/actions:refreshReserveSnapshot '{}'`) has written a snapshot — or "Indisponível" with no fabricated number before then.
- The "Verificar na rede Stellar" link points at `…/testnet/contract/CBDGKVRP…C7Y2`.
- Visiting `/health` 308-redirects to `/transparency`.

---

## Self-Review

**Spec coverage** — gaps from the review map to tasks: rename (B-none/N1/N3 → Tasks 1–4); reserve module + env + schema (S1/S3/S4 → Tasks 5–8); real onchain read replacing mock/XLM-rate/wrong-account (B2/B3/B4 → Tasks 9–12); explorer link (B1 → Task 11/12); default-rate (B5 → Task 13); capacity label (B6 → Task 13); staleness/"as of" + honest footer (T1/T3 → Tasks 12/14); SSR+reactive instead of client `useAction` (T2 → Task 12). Terminology split treasury vs reserve (N2) → Tasks 11–14.

**Placeholder scan** — every code step contains full code; the one network-dependent unit (Task 9 action) is explicitly verified manually (Task 9 Step 4) with the pure math separately tested (Task 7).

**Type consistency** — `ReserveAsset`/`ReserveReadResult`/`reserveAssetValidator` (Task 7) are consumed unchanged by the action (Task 9) and use cases (Task 8); `ReserveCoverage` (Task 11) is consumed by the panel and page (Task 12); `defaultRate: number | null` (Task 13) matches the panel guard. `storedValueCentsFromAssets(assets, symbols)` and `rawBalanceToCents(raw, decimals)` signatures are identical across Tasks 7/9.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-10-transparency-reserve-coverage.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

---

# PR 5 — BRL valuation via FX (real per-asset conversion)

**Why:** The deployed testnet vault holds `USDCMOCK` (a USD-pegged token), not a BRL asset. The v1 "BRL-pegged only" rule scored it 0. Requirement: value **every** approved asset in BRL at the current rate — USD-pegged assets convert at the live USD→BRL rate, BRL-pegged at 1:1. Store the rate + per-asset BRL value in the snapshot (auditability), and show the rate on the tile.

**FX source:** keyless Frankfurter (`https://api.frankfurter.app/latest?from=USD&to=BRL`, ECB-sourced), env-swappable via `FX_USD_BRL_URL`. Production upgrade (follow-up, not this PR): BCB PTAX official reference rate.

**Precision:** keep BigInt. Quantize the FX rate to micro-units (`rateMicro = round(rate × 1e6)`) so the conversion stays integer math: `cents = round(raw × rateMicro / (10^decimals × 1e4))`.

## Task 16 — env getters (TDD)
`convex/lib/env.ts` + append to `convex/lib/env.test.ts`:
```ts
export function getReserveUsdSymbols(): readonly string[] {
  const raw = process.env.STELLAR_RESERVE_USD_SYMBOLS; // hook-ok: env module boundary
  if (raw) { const p = raw.split(",").map((s) => s.trim()).filter(Boolean); if (p.length > 0) return p; }
  return ["USDC", "USDCMOCK"];
}
export function getFxUsdBrlUrl(): string {
  return process.env.FX_USD_BRL_URL ?? "https://api.frankfurter.app/latest?from=USD&to=BRL"; // hook-ok: env module boundary
}
```
Tests: default symbols, CSV override, empty-parse fallback; default FX url, override.

## Task 17 — domain pricing (TDD)
`convex/reserve/domain.ts`:
- Add `ReserveValuedAsset = ReserveAsset & { valueCents: number }`.
- Change `ReserveReadResult.available` to `{ available: true; storedValueCents: number; fxUsdBrl: number; assets: ReserveValuedAsset[] }`.
- Add `valueCents: v.number()` to `reserveAssetValidator` (this is the STORED asset shape).
- Add `ReservePricing = { brlSymbols: readonly string[]; usdSymbols: readonly string[]; usdBrlRate: number }`.
- Add:
```ts
export function assetRateBrl(symbol: string, pricing: ReservePricing): number | null {
  if (pricing.brlSymbols.includes(symbol)) return 1;
  if (pricing.usdSymbols.includes(symbol)) return pricing.usdBrlRate;
  return null;
}
export function assetValueCents(rawBalance: string, decimals: number, rateBrl: number): number {
  const negative = rawBalance.startsWith("-");
  const digits = negative ? rawBalance.slice(1) : rawBalance;
  const raw = BigInt(digits.length ? digits : "0");
  const rateMicro = BigInt(Math.round(rateBrl * 1_000_000));
  const denom = BigInt(10) ** BigInt(decimals) * BigInt(10000);
  const num = raw * rateMicro;
  const whole = num / denom;
  const remainder = num % denom;
  const rounded = remainder * BigInt(2) >= denom ? whole + BigInt(1) : whole;
  const result = Number(rounded);
  return negative ? -result : result;
}
export function valueAssets(assets: ReserveAsset[], pricing: ReservePricing): ReserveValuedAsset[] {
  return assets.map((a) => {
    const rate = assetRateBrl(a.symbol, pricing);
    return { ...a, valueCents: rate === null ? 0 : assetValueCents(a.rawBalance, a.decimals, rate) };
  });
}
export function storedValueCentsFromValuedAssets(assets: ReserveValuedAsset[]): number {
  return assets.reduce((c, a) => c + a.valueCents, 0);
}
```
- REMOVE the old `storedValueCentsFromAssets(assets, brlPeggedSymbols)`; keep `rawBalanceToCents` (still the BRL-1:1 primitive; note `assetValueCents(raw, dec, 1) === rawBalanceToCents(raw, dec)`).
- Update `convex/reserve/domain.test.ts`: keep `rawBalanceToCents` cases; add `assetValueCents` (USD rate e.g. 5.5 → check cents), `assetRateBrl` (brl→1, usd→rate, other→null), `valueAssets` + `storedValueCentsFromValuedAssets` (mixed BRL+USD+unpriced).

## Task 18 — schema + FX fetch + action (+clear op)
- `convex/schema.ts` `reserveSnapshots`: add `fxUsdBrl: v.number()`; the `assets` element gains `valueCents: v.number()` (keep it identical to `reserveAssetValidator` — update the inline mirror comment).
- `convex/reserve/useCases.ts`: `writeSnapshot` args gain `fxUsdBrl: v.number()` (assets already validated by `reserveAssetValidator` which now includes valueCents). Add `clearSnapshots` internalMutation (deletes all `reserveSnapshots` rows — used to reset dev data after the schema change; also a useful ops primitive).
- `convex/reserve/actions.ts`: add a tagged FX fetch and wire pricing:
```ts
type FxResponse = { rates?: { BRL?: number } };
async function fetchUsdBrlRate(): Promise<number> {
  const res = await fetch(getFxUsdBrlUrl(), { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`FX ${res.status} ${res.statusText}`);
  const data = (await res.json()) as FxResponse; // hook-ok: external FX API response
  const rate = data.rates?.BRL;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new Error("FX: invalid BRL rate");
  return rate;
}
```
In `readReserve()`, inside the try: fetch `usdBrlRate` (so an FX failure → `{ available: false }`, never a fabricated number), build `pricing = { brlSymbols: getReserveBrlPeggedSymbols(), usdSymbols: getReserveUsdSymbols(), usdBrlRate }`, `const valued = valueAssets(assets, pricing)`, `storedValueCents = storedValueCentsFromValuedAssets(valued)`, return `{ available: true, storedValueCents, fxUsdBrl: usdBrlRate, assets: valued }`. `refreshReserveSnapshot` passes `fxUsdBrl` to `writeSnapshot`.

## Task 19 — query + panel + i18n
- `convex/transparency/domain.ts`: `ReserveCoverage` available branch gains `fxUsdBrl: number`.
- `convex/transparency/useCases.ts` `getReserveCoverage`: include `fxUsdBrl: snap.fxUsdBrl` in the available return.
- `reserve-panel.tsx`: under the "as of" line, when available, render the FX rate, e.g. `t("fx", { rate })` formatted `new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(coverage.fxUsdBrl)`.
- i18n both locales `transparency.reserve`: add `fx` (pt-BR "Cotação USD/BRL: {rate}", en "USD/BRL rate: {rate}").
- Update `convex/transparency/useCases.test.ts` seed (`writeSnapshot`) to include `fxUsdBrl` and the new asset `valueCents` so it still typechecks/passes.

## Task 20 — reset dev data + smoke
- Run `bunx convex run reserve/useCases:clearSnapshots '{}'` (clear the pre-FX row so the new required schema fields are satisfiable).
- Run `bunx convex run reserve/actions:refreshReserveSnapshot '{}'`, then `latestSnapshot` — expect `fxUsdBrl ≈ 5.x`, `assets[0].valueCents > 0` for USDCMOCK, `storedValueCents ≈ 992500 × rate × 100`.
- Reload `/transparency` — coverage tile shows the BRL figure + "Cotação USD/BRL".

**Verification:** `bun --filter @mutav/agency test`, `bun run typecheck`, `bun run lint`, `bun --filter @mutav/agency build` all green.
