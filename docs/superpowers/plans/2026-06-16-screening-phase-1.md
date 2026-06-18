# Screening Domain — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vendor-neutral `convex/screening/` domain (capability-typed providers, fan-out + idempotent signal storage + reproducible assessment snapshots) and migrate the existing BigDataCorp tenant-credit path onto it, killing the silent-mock provenance bug.

**Architecture:** `screening/` is a 4th provider family (alongside `anchors`, `settlement/providers`, `compliance/providers`). Providers implement a `query({subjectType, document, capability}) → ProviderSignal` port and catch their own errors (returning `status:"error"`, never throwing). A `runScreening` action resolves providers for a capability, fans out, records each signal idempotently (day-window dedup via Convex OCC), then derives a consumer-owned assessment snapshot. `contracts/` becomes a thin consumer for the `credit_score` capability.

**Tech Stack:** Convex (V8 queries/mutations/actions), TypeScript strict, `convex-test` + Vitest (edge-runtime), WebCrypto `hashPii` (existing HMAC sidecar).

**Spec:** `docs/superpowers/specs/2026-06-16-screening-domain-design.md`. Product/score mapping deferred to [#184](https://github.com/mutav-finance/mutav-app/issues/184).

**Test commands:**
- Targeted: `bun --filter @mutav/agency test <path>` (e.g. `bun --filter @mutav/agency test convex/screening/domain.test.ts`)
- Full suite: `bun run test`  ·  Types: `bun run typecheck`  ·  Lint: `bun run lint`

**Conventions to honor (from CLAUDE.md):** relative imports inside `convex/` (no `@` alias); no `any`/`as Type`/`!` (use `// hook-ok: <reason>` only at external-response edges); `domain.ts` owns `Doc<>`/`Id<>` aliases + validators; every query uses an index (no `.filter()`); no barrel files.

---

## File structure

| File | Responsibility |
|---|---|
| `convex/screening/domain.ts` (create) | Type aliases, capability/subject/purpose constants + validators, the `ScreeningProvider` port + `ProviderSignal`, pure helpers (`windowKeyForDay`, `deriveTenantUnderwriting`) |
| `convex/screening/providers/mock.ts` (create) | Deterministic dev provider + exported pure `mockScoreFor` |
| `convex/screening/providers/cpfcnpj.ts` (create) | CPF.CNPJ adapter (moved) + exported pure `parseScoreRange` |
| `convex/screening/providers/bigdatacorp.ts` (create) | BigDataCorp adapter (moved): token mint + marketplace + capability→dataset map + exported pure `extractBigDataCorpScore` |
| `convex/screening/registry.ts` (create) | `resolveCreditProviders({document})` — capability→provider resolution, no silent mock fallback |
| `convex/screening/useCases.ts` (create) | `recordSignal` (idempotent internalMutation), `recordAssessment` (internalMutation), `getFreshAssessment` (internalQuery) |
| `convex/screening/actions.ts` (create) | `runScreening` internalAction — fan-out + persist + derive |
| `convex/screening/README.md` (create) | When-to-use doc for the domain |
| `convex/schema.ts` (modify) | Add `screeningSignals` + `screeningAssessments` tables; deprecate `tenantCreditReports` |
| `convex/contracts/useCases.ts` (modify) | Rewire `getCachedCreditScore` + `requestCreditScore` onto screening; remove `saveCreditReport` |
| `convex/contracts/actions.ts` (modify) | Remove `fetchCreditScore` + its now-unused imports (keep `sendProposalNotifications`) |
| `convex/contracts/scoreProviders.ts` (delete) | Moved into `screening/providers/*` |
| `docs/architecture/README.md` (modify) | Add `screening` to the domain catalog |

**Layering note (no cycle):** `screening/domain.ts` imports the pure `tierForScore` from `contracts/domain.ts`. `contracts/domain.ts` imports nothing from screening, so there is no cycle (`contracts/useCases → screening/actions → screening/domain → contracts/domain`, a DAG). The tier policy is the consumer's; Phase 2's second purpose (agency KYB) revisits whether per-purpose policies should invert fully into consumers.

---

## Task 1: Screening domain types + pure helpers

**Files:**
- Create: `convex/screening/domain.ts`
- Test: `convex/screening/domain.test.ts`

- [ ] **Step 1: Write the failing test** (`convex/screening/domain.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { windowKeyForDay, deriveTenantUnderwriting, type ProviderSignal } from "./domain";

const DAY = 24 * 60 * 60 * 1000;

describe("windowKeyForDay", () => {
  test("two timestamps in the same UTC day share a key", () => {
    expect(windowKeyForDay(5 * DAY + 1)).toBe(windowKeyForDay(5 * DAY + DAY - 1));
  });
  test("adjacent days differ", () => {
    expect(windowKeyForDay(5 * DAY)).not.toBe(windowKeyForDay(6 * DAY));
  });
});

describe("deriveTenantUnderwriting", () => {
  const ok = (score: number): ProviderSignal => ({
    status: "ok",
    provider: "mock",
    capability: "credit_score",
    normalized: { score, scale: 1000 },
  });
  const err: ProviderSignal = {
    status: "error",
    provider: "bigdatacorp",
    capability: "credit_score",
    error: "boom",
  };

  test("no ok signals → unavailable", () => {
    expect(deriveTenantUnderwriting([err]).status).toBe("unavailable");
  });
  test("maps the primary ok signal's score to a tier", () => {
    const out = deriveTenantUnderwriting([ok(850), err]);
    expect(out).toEqual({ status: "ok", result: { score: 850, tier: "bom" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @mutav/agency test convex/screening/domain.test.ts`
Expected: FAIL — cannot resolve `./domain` / exports undefined.

- [ ] **Step 3: Write `convex/screening/domain.ts`**

```ts
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { type ScoreTier, tierForScore } from "../contracts/domain";

export type ScreeningSignal = Doc<"screeningSignals">;
export type ScreeningSignalId = Id<"screeningSignals">;
export type ScreeningAssessment = Doc<"screeningAssessments">;
export type ScreeningAssessmentId = Id<"screeningAssessments">;

export type Capability = "credit_score";
export const CAPABILITY = { CREDIT_SCORE: "credit_score" } as const satisfies Record<string, Capability>;
export const capabilityValidator = v.union(v.literal(CAPABILITY.CREDIT_SCORE));

export type SubjectType = "tenant" | "agency" | "investor";
export const SUBJECT_TYPE = {
  TENANT: "tenant",
  AGENCY: "agency",
  INVESTOR: "investor",
} as const satisfies Record<Uppercase<SubjectType>, SubjectType>;
export const subjectTypeValidator = v.union(
  v.literal(SUBJECT_TYPE.TENANT),
  v.literal(SUBJECT_TYPE.AGENCY),
  v.literal(SUBJECT_TYPE.INVESTOR),
);

export type ScreeningPurpose = "tenant_underwriting";
export const SCREENING_PURPOSE = { TENANT_UNDERWRITING: "tenant_underwriting" } as const;
export const screeningPurposeValidator = v.literal(SCREENING_PURPOSE.TENANT_UNDERWRITING);

export const POLICY_VERSION = { TENANT_UNDERWRITING: "tenant_underwriting_v1" } as const;
export const DEFAULT_CREDIT_SCALE = 1000;

export type SignalStatus = "ok" | "error";
export type AssessmentStatus = "ok" | "unavailable";

export type CreditScoreNormalized = { score: number; scale: number };

export type ProviderRequest = {
  subjectType: SubjectType;
  document: string;
  capability: Capability;
};

export type ProviderSignal =
  | {
      status: "ok";
      provider: string;
      capability: Capability;
      normalized: CreditScoreNormalized;
      vendorRef?: string;
    }
  | { status: "error"; provider: string; capability: Capability; error: string };

export interface ScreeningProvider {
  readonly name: string;
  readonly capabilities: readonly Capability[];
  query(req: ProviderRequest): Promise<ProviderSignal>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Coarse idempotency bucket: signals for the same subject+capability+provider
 * within one UTC day dedupe to a single paid pull. */
export function windowKeyForDay(timestampMs: number): string {
  return `d${Math.floor(timestampMs / DAY_MS)}`;
}

export type TenantUnderwritingResult = { score: number; tier: ScoreTier };

/** Consumer (contracts/underwriting) aggregation policy — pure. Phase 1 uses a
 * single primary provider; takes the first ok signal. */
export function deriveTenantUnderwriting(
  signals: readonly ProviderSignal[],
): { status: "ok"; result: TenantUnderwritingResult } | { status: "unavailable" } {
  const ok = signals.filter(
    (s): s is Extract<ProviderSignal, { status: "ok" }> => s.status === "ok",
  );
  const primary = ok[0];
  if (!primary) return { status: "unavailable" };
  return {
    status: "ok",
    result: { score: primary.normalized.score, tier: tierForScore(primary.normalized.score) },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @mutav/agency test convex/screening/domain.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/screening/domain.ts convex/screening/domain.test.ts
git commit -m "feat(screening): domain types, port, and pure aggregation helpers"
```

---

## Task 2: Provider adapters (mock, cpfcnpj, bigdatacorp)

Move the three providers off `contracts/scoreProviders.ts` into capability-typed adapters. Each provider catches its own errors and returns a `ProviderSignal` (never throws). Pure extraction helpers are exported for unit testing (the historically bug-prone part).

**Files:**
- Create: `convex/screening/providers/mock.ts`, `convex/screening/providers/cpfcnpj.ts`, `convex/screening/providers/bigdatacorp.ts`
- Test: `convex/screening/providers/providers.test.ts`

- [ ] **Step 1: Write the failing test** (`convex/screening/providers/providers.test.ts`)

```ts
import { describe, expect, test } from "vitest";
import { mockScoreFor } from "./mock";
import { parseScoreRange } from "./cpfcnpj";
import { extractBigDataCorpScore } from "./bigdatacorp";

describe("mockScoreFor", () => {
  test("deterministic within [300, 900]", () => {
    const s = mockScoreFor("12345678901");
    expect(s).toBe(mockScoreFor("12345678901"));
    expect(s).toBeGreaterThanOrEqual(300);
    expect(s).toBeLessThanOrEqual(900);
  });
});

describe("parseScoreRange", () => {
  test("range midpoint", () => expect(parseScoreRange("501-700")).toBe(600));
  test("single value", () => expect(parseScoreRange("1000")).toBe(1000));
  test("garbage → null", () => expect(parseScoreRange("abc")).toBeNull());
});

describe("extractBigDataCorpScore", () => {
  const dataset = "partner_boavista_one_score_person";
  test("reads Score from the dataset block", () => {
    const json = { Results: [{ [dataset]: { Score: 742 } }] };
    expect(extractBigDataCorpScore(json, dataset)).toBe(742);
  });
  test("accepts the Pontos alias", () => {
    const json = { Results: [{ [dataset]: { Pontos: 610 } }] };
    expect(extractBigDataCorpScore(json, dataset)).toBe(610);
  });
  test("missing score → null", () => {
    expect(extractBigDataCorpScore({ Results: [{ [dataset]: {} }] }, dataset)).toBeNull();
    expect(extractBigDataCorpScore({ Results: [] }, dataset)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @mutav/agency test convex/screening/providers/providers.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3a: Write `convex/screening/providers/mock.ts`**

```ts
import { CAPABILITY, DEFAULT_CREDIT_SCALE, type ProviderRequest, type ProviderSignal, type ScreeningProvider } from "../domain";

/** Deterministic dev score in [300, 900] from the last 4 document digits. */
export function mockScoreFor(document: string): number {
  const digits = document.replace(/\D/g, "");
  return (parseInt(digits.slice(-4), 10) % 601) + 300;
}

export const mockProvider: ScreeningProvider = {
  name: "mock",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  async query(req: ProviderRequest): Promise<ProviderSignal> {
    return {
      status: "ok",
      provider: "mock",
      capability: CAPABILITY.CREDIT_SCORE,
      normalized: { score: mockScoreFor(req.document), scale: DEFAULT_CREDIT_SCALE },
    };
  },
};
```

- [ ] **Step 3b: Write `convex/screening/providers/cpfcnpj.ts`**

```ts
import { getCpfCnpjToken } from "../../lib/env";
import { CAPABILITY, DEFAULT_CREDIT_SCALE, type ProviderRequest, type ProviderSignal, type ScreeningProvider } from "../domain";

/** "501-700" → 600 (midpoint); "1000" → 1000; unparseable → null. */
export function parseScoreRange(range: string): number | null {
  const parts = range.split("-").map((s) => parseInt(s.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return Math.round((parts[0] + parts[1]) / 2);
  }
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  return null;
}

// Pacote 13 — CPF Risco. GET https://api.cpfcnpj.com.br/{token}/13/{cpf}
export const cpfCnpjProvider: ScreeningProvider = {
  name: "cpfcnpj",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  async query(req: ProviderRequest): Promise<ProviderSignal> {
    try {
      const token = getCpfCnpjToken();
      const digits = req.document.replace(/\D/g, "");
      const res = await fetch(`https://api.cpfcnpj.com.br/${token}/13/${digits}`);
      if (!res.ok) {
        return { status: "error", provider: "cpfcnpj", capability: req.capability, error: `query ${res.status}` };
      }
      const data = (await res.json()) as Record<string, unknown>; // hook-ok: external API response
      const risco = data["CPF Risco"] as Record<string, unknown> | undefined; // hook-ok: external API response
      const scoreRange = risco?.["score"];
      const score = typeof scoreRange === "string" ? parseScoreRange(scoreRange) : null;
      if (score === null) {
        return { status: "error", provider: "cpfcnpj", capability: req.capability, error: "score field missing/unparseable" };
      }
      return {
        status: "ok",
        provider: "cpfcnpj",
        capability: CAPABILITY.CREDIT_SCORE,
        normalized: { score, scale: DEFAULT_CREDIT_SCALE },
      };
    } catch (e) {
      return { status: "error", provider: "cpfcnpj", capability: req.capability, error: String(e) };
    }
  },
};
```

- [ ] **Step 3c: Write `convex/screening/providers/bigdatacorp.ts`**

```ts
import { getBigDataCorpLogin, getBigDataCorpPassword, getBigDataCorpDataset } from "../../lib/env";
import { CAPABILITY, DEFAULT_CREDIT_SCALE, type Capability, type ProviderRequest, type ProviderSignal, type ScreeningProvider } from "../domain";

const AUTH_URL = "https://plataforma.bigdatacorp.com.br/tokens/generate";
const MARKETPLACE_URL = "https://plataforma.bigdatacorp.com.br/marketplace";

/** Capability → BigDataCorp dataset. Env override applies to credit_score
 * (defaults to BoaVista One Score). New capabilities (registration, …) add
 * their dataset here in Phase 2. */
function datasetFor(capability: Capability): string {
  return getBigDataCorpDataset();
}

type BigDataCorpToken = { AccessToken: string; TokenId: string };

async function mintToken(): Promise<BigDataCorpToken> {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Login: getBigDataCorpLogin(), Password: getBigDataCorpPassword() }),
  });
  if (!res.ok) throw new Error(`auth ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>; // hook-ok: external API response
  const token = (data["AccessToken"] ?? data["accessToken"]) as string | undefined; // hook-ok: external API response
  const tokenId = (data["TokenId"] ?? data["tokenId"]) as string | undefined; // hook-ok: external API response
  if (!token || !tokenId) throw new Error("unexpected auth response shape");
  return { AccessToken: token, TokenId: tokenId };
}

/** Pulls the numeric score out of a BigDataCorp marketplace response. Tries the
 * known field aliases. Pure + exported for unit testing. */
export function extractBigDataCorpScore(json: unknown, dataset: string): number | null {
  if (typeof json !== "object" || json === null) return null;
  const results = (json as { Results?: unknown }).Results; // hook-ok: external API response
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (typeof first !== "object" || first === null) return null;
  const block = (first as Record<string, unknown>)[dataset];
  if (typeof block !== "object" || block === null) return null;
  const fields = block as Record<string, unknown>;
  const raw = fields["Score"] ?? fields["Pontos"] ?? fields["ScoreCredito"] ?? fields["Pontuacao"];
  return typeof raw === "number" ? raw : null;
}

export const bigDataCorpProvider: ScreeningProvider = {
  name: "bigdatacorp",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  async query(req: ProviderRequest): Promise<ProviderSignal> {
    try {
      const token = await mintToken();
      const dataset = datasetFor(req.capability);
      const res = await fetch(MARKETPLACE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AccessToken: token.AccessToken,
          TokenId: token.TokenId,
        },
        body: JSON.stringify({ q: `doc${req.document}`, Datasets: dataset, type: "mix" }),
      });
      if (!res.ok) {
        return { status: "error", provider: "bigdatacorp", capability: req.capability, error: `query ${res.status}` };
      }
      const data = (await res.json()) as { QueryId?: string }; // hook-ok: external API response
      const score = extractBigDataCorpScore(data, dataset);
      if (score === null) {
        return { status: "error", provider: "bigdatacorp", capability: req.capability, error: "score field not found" };
      }
      return {
        status: "ok",
        provider: "bigdatacorp",
        capability: CAPABILITY.CREDIT_SCORE,
        normalized: { score, scale: DEFAULT_CREDIT_SCALE },
        vendorRef: typeof data.QueryId === "string" ? data.QueryId : undefined,
      };
    } catch (e) {
      return { status: "error", provider: "bigdatacorp", capability: req.capability, error: String(e) };
    }
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @mutav/agency test convex/screening/providers/providers.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/screening/providers
git commit -m "feat(screening): capability-typed mock/cpfcnpj/bigdatacorp adapters"
```

---

## Task 3: Provider registry

`resolveCreditProviders` is the single place the credit_score capability picks providers. CNPJ resolves to `mock` (no bureau supports CNPJ credit in Phase 1); CPF resolves to the env-configured provider. **No silent fallback to mock on an unknown name** — that throws (the old `resolveProvider` masking is the provenance bug's root).

**Files:**
- Create: `convex/screening/registry.ts`
- Test: `convex/screening/registry.test.ts`

- [ ] **Step 1: Write the failing test** (`convex/screening/registry.test.ts`)

```ts
import { afterEach, describe, expect, test } from "vitest";
import { resolveCreditProviders } from "./registry";

afterEach(() => {
  delete process.env.SCORE_PROVIDER;
});

describe("resolveCreditProviders", () => {
  test("CNPJ (14 digits) always resolves to mock", () => {
    process.env.SCORE_PROVIDER = "bigdatacorp";
    expect(resolveCreditProviders({ document: "12345678000190" }).map((p) => p.name)).toEqual(["mock"]);
  });
  test("CPF with no env → mock default", () => {
    expect(resolveCreditProviders({ document: "12345678901" }).map((p) => p.name)).toEqual(["mock"]);
  });
  test("CPF honors SCORE_PROVIDER", () => {
    process.env.SCORE_PROVIDER = "bigdatacorp";
    expect(resolveCreditProviders({ document: "12345678901" }).map((p) => p.name)).toEqual(["bigdatacorp"]);
  });
  test("unknown provider throws (no silent mock fallback)", () => {
    process.env.SCORE_PROVIDER = "nope";
    expect(() => resolveCreditProviders({ document: "12345678901" })).toThrow(/nope/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @mutav/agency test convex/screening/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `convex/screening/registry.ts`**

```ts
import { getScoreProvider } from "../lib/env";
import type { ScreeningProvider } from "./domain";
import { mockProvider } from "./providers/mock";
import { cpfCnpjProvider } from "./providers/cpfcnpj";
import { bigDataCorpProvider } from "./providers/bigdatacorp";

const CREDIT_PROVIDERS: Record<string, ScreeningProvider> = {
  mock: mockProvider,
  cpfcnpj: cpfCnpjProvider,
  bigdatacorp: bigDataCorpProvider,
};

/** Providers to fan out for a credit_score pull on `document`. Phase 1 returns
 * exactly one (the primary); the array shape lets Phase 2 add hedge providers
 * without changing callers. */
export function resolveCreditProviders({ document }: { document: string }): ScreeningProvider[] {
  const digits = document.replace(/\D/g, "");
  if (digits.length === 14) return [mockProvider];

  const name = getScoreProvider();
  const primary = CREDIT_PROVIDERS[name];
  if (!primary) {
    throw new Error(
      `SCORE_PROVIDER="${name}" is not a known screening provider (expected: ${Object.keys(CREDIT_PROVIDERS).join(", ")}).`,
    );
  }
  return [primary];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @mutav/agency test convex/screening/registry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/screening/registry.ts convex/screening/registry.test.ts
git commit -m "feat(screening): credit provider registry, no silent mock fallback"
```

---

## Task 4: Schema tables

Add `screeningSignals` (append-only) + `screeningAssessments` (snapshots). Deprecate `tenantCreditReports` in place (leave defined to avoid a "table has documents" push failure; drop in a follow-up migration once data is cleared).

**Files:**
- Modify: `convex/schema.ts`

- [ ] **Step 1: Add the two tables**

In `convex/schema.ts`, immediately before the closing `});` of the `defineSchema({ ... })` call (i.e. after the `tenantCreditReports` table), insert:

```ts
  // ── Screening (vendor-neutral risk/verification signals) ──────────────────
  // Append-only. One row per (provider × capability × pull). `subjectHash` is
  // HMAC-SHA256 of the CPF/CNPJ digits (same key as `tenantCreditReports`).
  // `windowKey` is the UTC-day idempotency bucket. No raw vendor payload in
  // Phase 1 (credit_score normalizes to a number); KYB raw lands encrypted in
  // Phase 2.
  screeningSignals: defineTable({
    agencyId: v.id("agencies"),
    subjectType: v.union(v.literal("tenant"), v.literal("agency"), v.literal("investor")),
    subjectHash: v.string(),
    capability: v.union(v.literal("credit_score")),
    provider: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    normalized: v.optional(v.object({ score: v.number(), scale: v.number() })),
    error: v.optional(v.string()),
    vendorRef: v.optional(v.string()),
    correlationId: v.string(),
    windowKey: v.string(),
    pulledAt: v.number(),
  })
    .index("by_idempotency", ["agencyId", "subjectHash", "capability", "provider", "windowKey"])
    .index("by_agency_subject_capability_time", ["agencyId", "subjectHash", "capability", "pulledAt"]),

  // Derived, reproducible decision snapshot. `signalIds` records exactly which
  // signals fed the result; `policyVersion` records the aggregation policy.
  screeningAssessments: defineTable({
    agencyId: v.id("agencies"),
    subjectType: v.union(v.literal("tenant"), v.literal("agency"), v.literal("investor")),
    subjectHash: v.string(),
    purpose: v.union(v.literal("tenant_underwriting")),
    policyVersion: v.string(),
    signalIds: v.array(v.id("screeningSignals")),
    status: v.union(v.literal("ok"), v.literal("unavailable")),
    result: v.optional(
      v.object({
        score: v.number(),
        tier: v.union(v.literal("bom"), v.literal("regular"), v.literal("ruim"), v.literal("negado")),
      }),
    ),
    decidedAt: v.number(),
  }).index("by_agency_subject_purpose_time", ["agencyId", "subjectHash", "purpose", "decidedAt"]),
```

- [ ] **Step 2: Mark `tenantCreditReports` deprecated**

Replace the comment block directly above `tenantCreditReports: defineTable({` with:

```ts
  // DEPRECATED (screening Phase 1): superseded by `screeningAssessments`
  // (purpose: tenant_underwriting). No longer written or read. Kept defined to
  // avoid a "table has documents" push failure; drop via a follow-up migration
  // once existing rows are cleared. See docs/superpowers/specs/2026-06-16-screening-domain-design.md.
  // Per-agency credit report cache. `cpfHash` is HMAC-SHA256 of the digits.
```

- [ ] **Step 3: Verify the schema typechecks**

Run: `bun run typecheck`
Expected: PASS (screening tables compile; nothing references them yet).

- [ ] **Step 4: Commit**

```bash
git add convex/schema.ts
git commit -m "feat(screening): screeningSignals + screeningAssessments tables; deprecate tenantCreditReports"
```

---

## Task 5: Engine persistence (recordSignal, recordAssessment, getFreshAssessment)

Internal functions only — the action and the contracts consumer call these. `recordSignal` is idempotent: within a UTC-day window the same (agency, subject, capability, provider) yields exactly one row. Under concurrent scheduling, Convex OCC retries the second mutation, which then finds the first's row and returns it (the reliability.md "insert-then-catch via OCC" pattern).

**Files:**
- Create: `convex/screening/useCases.ts`
- Test: `convex/screening/useCases.test.ts`

- [ ] **Step 1: Write the failing test** (`convex/screening/useCases.test.ts`)

```ts
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

async function seedAgency(t: ReturnType<typeof convexTest>): Promise<Id<"agencies">> {
  return t.run(async (ctx) =>
    ctx.db.insert("agencies", {
      name: "Acme",
      cnpj: "12345678000190",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    }),
  );
}

test("recordSignal is idempotent within a window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const base = {
    agencyId,
    subjectType: "tenant" as const,
    subjectHash: "hash-1",
    capability: "credit_score" as const,
    provider: "mock",
    status: "ok" as const,
    normalized: { score: 700, scale: 1000 },
    correlationId: "corr-1",
    windowKey: "d100",
    pulledAt: 100 * 24 * 60 * 60 * 1000,
  };
  const first = await t.mutation(internal.screening.useCases.recordSignal, base);
  const second = await t.mutation(internal.screening.useCases.recordSignal, { ...base, correlationId: "corr-2" });
  expect(second).toBe(first);
  const rows = await t.run((ctx) => ctx.db.query("screeningSignals").collect());
  expect(rows).toHaveLength(1);
});

test("getFreshAssessment respects the TTL window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const now = 1_000_000_000_000;
  await t.run((ctx) =>
    ctx.db.insert("screeningAssessments", {
      agencyId,
      subjectType: "tenant",
      subjectHash: "hash-2",
      purpose: "tenant_underwriting",
      policyVersion: "tenant_underwriting_v1",
      signalIds: [],
      status: "ok",
      result: { score: 800, tier: "bom" },
      decidedAt: now - 1000,
    }),
  );
  const fresh = await t.query(internal.screening.useCases.getFreshAssessment, {
    agencyId,
    subjectHash: "hash-2",
    purpose: "tenant_underwriting",
    notBefore: now - 5000,
  });
  expect(fresh?.result?.tier).toBe("bom");
  const stale = await t.query(internal.screening.useCases.getFreshAssessment, {
    agencyId,
    subjectHash: "hash-2",
    purpose: "tenant_underwriting",
    notBefore: now,
  });
  expect(stale).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @mutav/agency test convex/screening/useCases.test.ts`
Expected: FAIL — `internal.screening.useCases.*` undefined.

- [ ] **Step 3: Write `convex/screening/useCases.ts`**

```ts
import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import type { ScreeningAssessmentId, ScreeningSignalId } from "./domain";
import {
  capabilityValidator,
  screeningPurposeValidator,
  subjectTypeValidator,
} from "./domain";

const normalizedValidator = v.object({ score: v.number(), scale: v.number() });
const resultValidator = v.object({
  score: v.number(),
  tier: v.union(v.literal("bom"), v.literal("regular"), v.literal("ruim"), v.literal("negado")),
});

export const recordSignal = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    subjectHash: v.string(),
    capability: capabilityValidator,
    provider: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    normalized: v.optional(normalizedValidator),
    error: v.optional(v.string()),
    vendorRef: v.optional(v.string()),
    correlationId: v.string(),
    windowKey: v.string(),
    pulledAt: v.number(),
  },
  handler: async (ctx, args): Promise<ScreeningSignalId> => {
    const existing = await ctx.db
      .query("screeningSignals")
      .withIndex("by_idempotency", (q) =>
        q
          .eq("agencyId", args.agencyId)
          .eq("subjectHash", args.subjectHash)
          .eq("capability", args.capability)
          .eq("provider", args.provider)
          .eq("windowKey", args.windowKey),
      )
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("screeningSignals", args);
  },
});

export const recordAssessment = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    subjectHash: v.string(),
    purpose: screeningPurposeValidator,
    policyVersion: v.string(),
    signalIds: v.array(v.id("screeningSignals")),
    status: v.union(v.literal("ok"), v.literal("unavailable")),
    result: v.optional(resultValidator),
    decidedAt: v.number(),
  },
  handler: async (ctx, args): Promise<ScreeningAssessmentId> => {
    return ctx.db.insert("screeningAssessments", args);
  },
});

export const getFreshAssessment = internalQuery({
  args: {
    agencyId: v.id("agencies"),
    subjectHash: v.string(),
    purpose: screeningPurposeValidator,
    notBefore: v.number(),
  },
  handler: async (ctx, { agencyId, subjectHash, purpose, notBefore }) => {
    return ctx.db
      .query("screeningAssessments")
      .withIndex("by_agency_subject_purpose_time", (q) =>
        q
          .eq("agencyId", agencyId)
          .eq("subjectHash", subjectHash)
          .eq("purpose", purpose)
          .gt("decidedAt", notBefore),
      )
      .order("desc")
      .first();
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @mutav/agency test convex/screening/useCases.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add convex/screening/useCases.ts convex/screening/useCases.test.ts
git commit -m "feat(screening): idempotent signal + assessment persistence"
```

---

## Task 6: Engine action (runScreening)

V8 internal action (fetch + crypto work in V8 — no `"use node"` needed). Resolves providers, fans out with `Promise.allSettled`, records each signal, derives the consumer assessment, records the snapshot.

**Files:**
- Create: `convex/screening/actions.ts`
- Test: `convex/screening/actions.test.ts`

- [ ] **Step 1: Write the failing test** (`convex/screening/actions.test.ts`)

```ts
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeAll, expect, test } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});
afterEach(() => {
  delete process.env.SCORE_PROVIDER; // defaults to mock
});

async function seedAgency(t: ReturnType<typeof convexTest>): Promise<Id<"agencies">> {
  return t.run(async (ctx) =>
    ctx.db.insert("agencies", {
      name: "Acme",
      cnpj: "12345678000190",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    }),
  );
}

test("runScreening (mock provider) writes one signal + an ok assessment", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  await t.action(internal.screening.actions.runScreening, {
    agencyId,
    subjectType: "tenant",
    document: "12345678901",
    capability: "credit_score",
    purpose: "tenant_underwriting",
  });
  const signals = await t.run((ctx) => ctx.db.query("screeningSignals").collect());
  const assessments = await t.run((ctx) => ctx.db.query("screeningAssessments").collect());
  expect(signals).toHaveLength(1);
  expect(signals[0].provider).toBe("mock");
  expect(signals[0].status).toBe("ok");
  expect(assessments).toHaveLength(1);
  expect(assessments[0].status).toBe("ok");
  expect(assessments[0].result?.tier).toBeDefined();
  expect(assessments[0].signalIds).toHaveLength(1);
});

test("runScreening is idempotent on signals within a day window", async () => {
  const t = convexTest(schema);
  const agencyId = await seedAgency(t);
  const args = {
    agencyId,
    subjectType: "tenant" as const,
    document: "12345678901",
    capability: "credit_score" as const,
    purpose: "tenant_underwriting" as const,
  };
  await t.action(internal.screening.actions.runScreening, args);
  await t.action(internal.screening.actions.runScreening, args);
  const signals = await t.run((ctx) => ctx.db.query("screeningSignals").collect());
  expect(signals).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @mutav/agency test convex/screening/actions.test.ts`
Expected: FAIL — `internal.screening.actions.runScreening` undefined.

- [ ] **Step 3: Write `convex/screening/actions.ts`**

```ts
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashPii } from "../lib/pii";
import {
  POLICY_VERSION,
  capabilityValidator,
  deriveTenantUnderwriting,
  screeningPurposeValidator,
  subjectTypeValidator,
  windowKeyForDay,
  type ProviderSignal,
} from "./domain";
import { resolveCreditProviders } from "./registry";

export const runScreening = internalAction({
  args: {
    agencyId: v.id("agencies"),
    subjectType: subjectTypeValidator,
    document: v.string(),
    capability: capabilityValidator,
    purpose: screeningPurposeValidator,
  },
  handler: async (ctx, { agencyId, subjectType, document, capability, purpose }) => {
    const digits = document.replace(/\D/g, "");
    const subjectHash = await hashPii(digits);
    const correlationId = crypto.randomUUID();
    const now = Date.now();
    const windowKey = windowKeyForDay(now);

    const providers = resolveCreditProviders({ document: digits });
    const settled = await Promise.allSettled(providers.map((p) => p.query({ subjectType, document: digits, capability })));

    const signals: ProviderSignal[] = settled.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { status: "error", provider: providers[i].name, capability, error: String(r.reason) },
    );

    const signalIds = [];
    for (const signal of signals) {
      const id = await ctx.runMutation(internal.screening.useCases.recordSignal, {
        agencyId,
        subjectType,
        subjectHash,
        capability,
        provider: signal.provider,
        status: signal.status,
        normalized: signal.status === "ok" ? signal.normalized : undefined,
        error: signal.status === "error" ? signal.error : undefined,
        vendorRef: signal.status === "ok" ? signal.vendorRef : undefined,
        correlationId,
        windowKey,
        pulledAt: now,
      });
      signalIds.push(id);
    }

    const derived = deriveTenantUnderwriting(signals);
    await ctx.runMutation(internal.screening.useCases.recordAssessment, {
      agencyId,
      subjectType,
      subjectHash,
      purpose,
      policyVersion: POLICY_VERSION.TENANT_UNDERWRITING,
      signalIds,
      status: derived.status,
      result: derived.status === "ok" ? derived.result : undefined,
      decidedAt: now,
    });
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @mutav/agency test convex/screening/actions.test.ts`
Expected: PASS (2 tests).

> If `crypto.randomUUID` is unavailable in the edge-runtime test env, the failure will be a `TypeError` here. Fix by deriving the id deterministically: `const correlationId = `${subjectHash}:${windowKey}`;` (still unique per subject+window). Re-run.

- [ ] **Step 5: Commit**

```bash
git add convex/screening/actions.ts convex/screening/actions.test.ts
git commit -m "feat(screening): runScreening fan-out action"
```

---

## Task 7: Rewire contracts onto screening; remove the old path

Point `contracts/` at screening, preserving the public API the wizard depends on (`requestCreditScore` returns `{status}`; `getCachedCreditScore` returns `{score, tier} | null`). Remove `fetchCreditScore`, `saveCreditReport`, and `scoreProviders.ts`.

**Files:**
- Modify: `convex/contracts/useCases.ts`
- Modify: `convex/contracts/actions.ts`
- Delete: `convex/contracts/scoreProviders.ts`
- Test: `convex/contracts/useCases.test.ts` (update)

- [ ] **Step 1: Confirm the wizard contract (read-only check)**

Run: `grep -n "requestScore\|getCachedCreditScore\|result.status" apps/agency/src/components/contracts/wizard-step2.tsx`
Expected: the mutation result is only checked as `result.status !== "invalid"`, and `getCachedCreditScore` is read as `{score, tier}`. Confirms the rewrite below stays API-compatible.

- [ ] **Step 2: Rewrite `getCachedCreditScore` and `requestCreditScore` in `convex/contracts/useCases.ts`**

Replace the entire block from `const CREDIT_CACHE_TTL_MS = ...` through the end of the `requestCreditScore` mutation (the `getCachedCreditScore` query, the `CREDIT_CACHE_TTL_MS` const, and `requestCreditScore`) with:

```ts
const CREDIT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Reads the freshest `tenant_underwriting` screening assessment for `document`
 * (CPF or CNPJ digits) within the 24h TTL. Returns null if none — the caller
 * triggers `requestCreditScore` to schedule a fresh pull.
 */
export const getCachedCreditScore = queryWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) return null;

    const subjectHash = await hashPii(digits);
    const assessment = await ctx.runQuery(internal.screening.useCases.getFreshAssessment, {
      agencyId: ctx.agencyId,
      subjectHash,
      purpose: "tenant_underwriting",
      notBefore: Date.now() - CREDIT_CACHE_TTL_MS,
    });
    if (!assessment || assessment.status !== "ok" || !assessment.result) return null;
    return { score: assessment.result.score, tier: assessment.result.tier };
  },
});

/**
 * Ensures a fresh `tenant_underwriting` assessment exists for `document`.
 * Fresh within 24h → `{ status: "cached" }`. Otherwise schedules the screening
 * fan-out (which writes `screeningAssessments` reactively) → `{ status: "fetching" }`.
 * CNPJ and CPF take the same path; the registry routes CNPJ to the mock provider.
 */
export const requestCreditScore = mutationWithAgencyScope({
  args: { document: v.string() },
  handler: async (ctx, { document }) => {
    const digits = document.replace(/\D/g, "");
    if (digits.length !== 11 && digits.length !== 14) {
      return { status: "invalid" } as const;
    }

    const subjectHash = await hashPii(digits);
    const fresh = await ctx.runQuery(internal.screening.useCases.getFreshAssessment, {
      agencyId: ctx.agencyId,
      subjectHash,
      purpose: "tenant_underwriting",
      notBefore: Date.now() - CREDIT_CACHE_TTL_MS,
    });
    if (fresh) return { status: "cached" } as const;

    await ctx.scheduler.runAfter(0, internal.screening.actions.runScreening, {
      agencyId: ctx.agencyId,
      subjectType: "tenant",
      document: digits,
      capability: "credit_score",
      purpose: "tenant_underwriting",
    });
    return { status: "fetching" } as const;
  },
});
```

> Note: `internal` is already imported in `useCases.ts` (`import { internal } from "../_generated/api";`). `mutationWithAgencyScope`/`queryWithAgencyScope` and `hashPii` are already imported. A `query`/`internalQuery` calling another `internalQuery` via `ctx.runQuery` is fine; both run in the same V8 transaction context.

- [ ] **Step 3: Remove `saveCreditReport` from `convex/contracts/useCases.ts`**

Delete the entire `export const saveCreditReport = internalMutation({ ... });` block (it was the old persistence path). Then check whether `internalMutation` is still used elsewhere in the file:

Run: `grep -n "internalMutation" convex/contracts/useCases.ts`
If no other usage remains, remove `internalMutation` from the import on line 3 (`import { internalMutation, internalQuery, query } from "../_generated/server";` → drop `internalMutation`). Leave `internalQuery`/`query` if still used.

- [ ] **Step 4: Remove `fetchCreditScore` from `convex/contracts/actions.ts`**

Delete the `// ─── Credit Score ───` section and the `export const fetchCreditScore = internalAction({ ... });` block (lines that import/use `resolveProvider`, `tierForScore`, `getScoreProvider`). Then remove the now-unused imports from the top of the file:
- `import { tierForScore } from "./domain";`
- `import { resolveProvider } from "./scoreProviders";`
- `getScoreProvider` from the `../lib/env` import list

Keep `sendProposalNotifications` and all its imports (`Resend`, `getResendApiKey`, etc.) intact.

- [ ] **Step 5: Delete the moved provider file**

```bash
git rm convex/contracts/scoreProviders.ts
```

- [ ] **Step 6: Update `convex/contracts/useCases.test.ts`**

Existing tests that drove the credit path through `saveCreditReport`/`requestCreditScore` need to assert the new behavior. Find them:

Run: `grep -n "saveCreditReport\|requestCreditScore\|getCachedCreditScore\|tenantCreditReports" convex/contracts/useCases.test.ts`

For each hit:
- Replace any direct `internal.contracts.useCases.saveCreditReport` call with the screening path: schedule via `api.contracts.useCases.requestCreditScore` (mock provider, default) and assert `getCachedCreditScore` returns `{score, tier}` after the scheduler runs. Example replacement test (add if no equivalent exists):

```ts
test("requestCreditScore (mock) makes a score readable via getCachedCreditScore", async () => {
  const t = convexTest(schema);
  registerContractAggregateComponents(t);
  const { userId } = await setupAuthenticatedUser(t);
  const agencyId = await seedAgencyWithMembership(t, userId, "12345678000190");
  const asAgency = t.withIdentity({ subject: userId });

  const req = await asAgency.mutation(api.contracts.useCases.requestCreditScore, {
    agencyId,
    document: "12345678901",
  });
  expect(req.status).toBe("fetching");
  await t.finishInProgressScheduledFunctions();

  const cached = await asAgency.query(api.contracts.useCases.getCachedCreditScore, {
    agencyId,
    document: "12345678901",
  });
  expect(cached).not.toBeNull();
  expect(cached?.tier).toBeDefined();
});
```

> Use the file's existing fixture helpers (`registerContractAggregateComponents`, `setupAuthenticatedUser`, `seedAgencyWithMembership`) and identity pattern — match how sibling tests in this file authenticate. `t.finishInProgressScheduledFunctions()` drains the scheduled `runScreening`.

- [ ] **Step 7: Run the affected suites to verify they pass**

Run: `bun --filter @mutav/agency test convex/contracts/useCases.test.ts`
Expected: PASS (updated + existing tests green).

- [ ] **Step 8: Full typecheck (catches any dangling reference)**

Run: `bun run typecheck`
Expected: PASS. If it flags a missing `scoreProviders`/`fetchCreditScore`/`saveCreditReport` reference, fix that caller.

- [ ] **Step 9: Commit**

```bash
git add convex/contracts/useCases.ts convex/contracts/actions.ts convex/contracts/useCases.test.ts
git rm --cached convex/contracts/scoreProviders.ts 2>/dev/null || true
git commit -m "refactor(contracts): consume screening for tenant credit; remove scoreProviders path"
```

---

## Task 8: Docs + final verification

**Files:**
- Create: `convex/screening/README.md`
- Modify: `docs/architecture/README.md`

- [ ] **Step 1: Write `convex/screening/README.md`**

```md
# screening

Vendor-neutral risk/verification **signal** layer — compliance.md's "Inputs to risk".
Fans out to external data providers, stores immutable signals, and derives
reproducible assessment snapshots. It does NOT make decisions and is NOT the KYC
verification workflow (that's `compliance/providers`) or the risk-classification
state machine (compliance's).

## Shape
- `domain.ts` — capability/subject/purpose types + validators, the `ScreeningProvider`
  port, pure aggregation policies.
- `providers/{vendor}.ts` — adapters. Each declares `capabilities` and catches its
  own errors (returns `status:"error"`, never throws). Vendor mechanics + the
  capability→dataset map live inside the adapter.
- `registry.ts` — resolves providers per capability. **Never** silently falls back
  to mock; unknown config throws.
- `useCases.ts` — `recordSignal` (idempotent), `recordAssessment`, `getFreshAssessment`.
- `actions.ts` — `runScreening` fan-out.

## Adding a provider
Add `providers/<vendor>.ts` implementing `ScreeningProvider`, register it in
`registry.ts`. No consumer changes.

## Capabilities
- `credit_score` (Phase 1) — CPF/CNPJ → numeric score. Consumed by `contracts/`
  for tenant underwriting (`tenant_underwriting` assessment).
- `registration`, `sanctions_pep` — Phase 2 (agency KYB; see #184 for score→product).
```

- [ ] **Step 2: Add `screening` to the architecture domain catalog**

In `docs/architecture/README.md`, find the domain catalog table/list and add a row consistent with the existing format, e.g.:

```md
| `screening` | Vendor-neutral external-data signals (credit, registration, sanctions) + reproducible assessment snapshots. Consumed by `contracts` (tenant underwriting) and, in Phase 2, `compliance` (agency KYB). |
```

> Match the exact column shape of the existing catalog entries in that file.

- [ ] **Step 3: Full verification**

Run: `bun run typecheck`
Expected: PASS.

Run: `bun run test`
Expected: PASS (all packages; new screening suites + updated contracts suite green).

Run: `bun run lint`
Expected: PASS (no `any`/`as Type`/`!` introduced; all external-response casts carry `// hook-ok`).

- [ ] **Step 4: Commit**

```bash
git add convex/screening/README.md docs/architecture/README.md
git commit -m "docs(screening): domain README + architecture catalog entry"
```

---

## Self-review checklist (completed during planning)

- **Spec coverage:** engine port (Tasks 1-3), fan-out + idempotency (Tasks 5-6), reproducible snapshots with `policyVersion`+`signalIds` (Tasks 4-6), signals-only fail policy / provenance-bug fix (Tasks 2-3, 6), summary-only storage — no `rawEncrypted` in Phase 1 (Task 4), subject-hash keying (Tasks 4-6), tenant-path migration + score surfaced not consumed (Task 7). Product mapping correctly deferred to #184 (not in plan).
- **Out-of-scope honored:** no agency KYB, no `registration`/`sanctions_pep` providers, no investor screening, no audit-log wiring (deferred to the compliance consumer in Phase 2, where risk-classification changes require it).
- **Type consistency:** `ProviderSignal`, `Capability`, `windowKeyForDay`, `deriveTenantUnderwriting`, `recordSignal`/`recordAssessment`/`getFreshAssessment`, `runScreening` signatures match across tasks; `getFreshAssessment` uses `notBefore` consistently in Tasks 5 and 7.
- **No placeholders:** every code/test step carries full code and an exact run command.

## Risks / watch-items for the executor

- **`crypto.randomUUID` in edge-runtime** — fallback noted inline in Task 6 Step 4.
- **`tenantCreditReports` left defined-but-deprecated** — intentional (avoids a "table has documents" push failure). A follow-up migration drops it after clearing rows.
- **`ctx.runQuery` from a wrapped `query`/`mutation`** — Task 7 calls `internal.screening.useCases.getFreshAssessment`; this runs in-transaction and inherits the caller's auth context. The agency scope is already asserted by the wrapper, and `getFreshAssessment` is filtered by `ctx.agencyId`, so no cross-agency leak.
- **Behavior change:** CNPJ scoring is now asynchronous (scheduled) rather than inline. The wizard reacts via `getCachedCreditScore`, and it only checks `status !== "invalid"`, so this is safe (verified in Task 7 Step 1).
