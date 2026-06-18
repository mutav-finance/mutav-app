# A1 — `screening` → `creditRisk` rename + trim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rename the `convex/screening/` domain to `convex/creditRisk/` and trim its assessment to a pure "credit analysis" (drop the underwriting `purpose`), keeping the tenant-credit path behaviorally identical.

**Architecture:** Slice A1 of `docs/superpowers/specs/2026-06-17-tenant-underwriting-architecture-design.md`. This is a behavior-preserving rename + schema reshape — no new capability. It supersedes PR #188's "screening" framing. The compliance substrate (purpose tags, `processingBasisRecords`, `tenantOutcomes`) is explicitly **out of scope** here — later slices.

**Tech Stack:** Convex (V8), TypeScript strict, convex-test + Vitest (edge-runtime).

**Critical constraint — atomicity:** A rename leaves the tree non-compiling until *every* reference moves. Do NOT commit partway. Task 1 is one atomic change verified green at the end; do not split it into per-file commits.

**Verification commands (authoritative):**
- Typecheck: `bun run typecheck -- --force` (turbo's cache does NOT track `convex/` — `--force` is mandatory or you'll get a stale pass)
- Tests: `bun --filter @mutav/agency test convex/creditRisk/ convex/contracts/useCases.test.ts` ; full: `bun run test`
- Lint: `bun run lint`

---

## Rename mapping (authoritative — apply consistently everywhere)

**Filesystem (use `git mv`):** `convex/screening/` → `convex/creditRisk/` (all 10 files incl. `providers/`).

**Tables:** `screeningSignals` → `creditRiskSignals` · `screeningAssessments` → `creditRiskAssessments`.

**Type aliases / interface:**
`ScreeningSignal`→`CreditRiskSignal` · `ScreeningSignalId`→`CreditRiskSignalId` · `ScreeningAssessment`→`CreditRiskAssessment` · `ScreeningAssessmentId`→`CreditRiskAssessmentId` · `ScreeningProvider`→`CreditRiskProvider`.

**Functions / values:**
`runScreening`→`runCreditAnalysis` · `deriveTenantUnderwriting`→`deriveCreditAnalysis` · `POLICY_VERSION.TENANT_UNDERWRITING` value `"tenant_underwriting_v1"`→`POLICY_VERSION.CREDIT_ANALYSIS` value `"credit_analysis_v1"`.

**Module references (api.d.ts + imports):** `screening/{actions,domain,registry,useCases,providers/bigdatacorp,providers/cpfcnpj,providers/mock}` → `creditRisk/...`; `internal.screening.*`→`internal.creditRisk.*`.

**Unchanged (do NOT rename):** `ProviderSignal`, `ProviderRequest`, `Capability`, `CAPABILITY`, `capabilityValidator`, `SubjectType`, `SUBJECT_TYPE`, `subjectTypeValidator`, `DEFAULT_CREDIT_SCALE`, `windowKeyForDay`, `findFreshAssessment`, `getFreshAssessment`, `recordSignal`, `recordAssessment`, the `creditRiskSignals` field shape.

**DELETE (the trim):** `ScreeningPurpose` type, `SCREENING_PURPOSE` const, `screeningPurposeValidator` — `purpose` leaves the assessment entirely.

---

## Task 1: Atomic rename + trim (code + schema + api + consumers + tests)

**Files:**
- Move: `convex/screening/**` → `convex/creditRisk/**` (git mv)
- Modify: `convex/schema.ts`, `convex/contracts/useCases.ts`, `convex/contracts/useCases.test.ts`, `convex/lib/env.ts`, `convex/_generated/api.d.ts`
- The moved module files + their tests (apply the mapping + the trim)

- [ ] **Step 1: Move the directory**

```bash
cd <worktree>
git mv convex/screening convex/creditRisk
```

- [ ] **Step 2: Apply the rename mapping inside every moved file**

In all of `convex/creditRisk/**`, apply the mapping table above (identifiers, `internal.screening`→`internal.creditRisk`, the `runScreening`→`runCreditAnalysis` and `deriveTenantUnderwriting`→`deriveCreditAnalysis` renames, `POLICY_VERSION`). Delete the `ScreeningPurpose`/`SCREENING_PURPOSE`/`screeningPurposeValidator` exports from `domain.ts` and any usage (the action no longer takes/handles `purpose`).

- [ ] **Step 3: Trim the assessment shape — `convex/creditRisk/domain.ts`**

The `CreditRiskAssessment` no longer carries `purpose`; score/tier are top-level. Update `deriveCreditAnalysis` to return the flattened shape:

```ts
export type CreditAnalysisResult = { score: number; tier: ScoreTier };

/** Pure credit-analysis derivation. Phase: single primary provider — first ok signal wins. */
export function deriveCreditAnalysis(
  signals: readonly ProviderSignal[],
): { status: "ok"; score: number; tier: ScoreTier } | { status: "unavailable" } {
  const ok = signals.filter(
    (s): s is Extract<ProviderSignal, { status: "ok" }> => s.status === "ok",
  );
  const primary = ok[0];
  if (!primary) return { status: "unavailable" };
  return { status: "ok", score: primary.normalized.score, tier: tierForScore(primary.normalized.score) };
}

export const POLICY_VERSION = { CREDIT_ANALYSIS: "credit_analysis_v1" } as const;
```

- [ ] **Step 4: Schema — `convex/schema.ts`**

Rename both tables and reshape the assessment (drop `purpose`; flatten `result{score,tier}`→top-level optional `score`/`tier`; `decidedAt`→`assessedAt`; index drops `purpose`). Replace the two table blocks with:

```ts
  creditRiskSignals: defineTable({
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

  creditRiskAssessments: defineTable({
    agencyId: v.id("agencies"),
    subjectType: v.union(v.literal("tenant"), v.literal("agency"), v.literal("investor")),
    subjectHash: v.string(),
    policyVersion: v.string(),
    signalIds: v.array(v.id("creditRiskSignals")),
    status: v.union(v.literal("ok"), v.literal("unavailable")),
    score: v.optional(v.number()),
    tier: v.optional(
      v.union(v.literal("bom"), v.literal("regular"), v.literal("ruim"), v.literal("negado")),
    ),
    assessedAt: v.number(),
  }).index("by_agency_subject_time", ["agencyId", "subjectHash", "assessedAt"]),
```

(Keep the `tenantCreditReports` deprecated table untouched.)

- [ ] **Step 5: Update `creditRisk/useCases.ts`** — `recordAssessment` args drop `purpose`, take top-level `score?`/`tier?` + `assessedAt`; `findFreshAssessment`/`getFreshAssessment` drop the `purpose` arg and use the `by_agency_subject_time` index (`eq agencyId, eq subjectHash, gt assessedAt`). `recordSignal` unchanged except table name. Use `tenantUnderwritingResultValidator`→rename to `creditAnalysisResultValidator` (or inline `score?`/`tier?`).

- [ ] **Step 6: Update `creditRisk/actions.ts`** — `runCreditAnalysis` drops the `purpose` arg; calls `deriveCreditAnalysis`; `recordAssessment` with `policyVersion: POLICY_VERSION.CREDIT_ANALYSIS`, `status`, `score`/`tier` (when ok), `assessedAt: now`.

- [ ] **Step 7: Update consumers — `convex/contracts/useCases.ts`**

```ts
import { findFreshAssessment } from "../creditRisk/useCases";
import { CAPABILITY, SUBJECT_TYPE } from "../creditRisk/domain";
```
`getCachedCreditScore`: `findFreshAssessment(ctx, { agencyId, subjectHash, notBefore })` (no purpose); return null unless `assessment.status === "ok" && assessment.score != null && assessment.tier != null`, else `{ score: assessment.score, tier: assessment.tier }`.
`requestCreditScore`: `findFreshAssessment(ctx, { agencyId, subjectHash, notBefore })`; schedule `internal.creditRisk.actions.runCreditAnalysis, { agencyId, subjectType: SUBJECT_TYPE.TENANT, document: digits, capability: CAPABILITY.CREDIT_SCORE }` (no purpose). Drop the `SCREENING_PURPOSE` import.

- [ ] **Step 8: Update `convex/lib/env.ts`** — the `getScoreProvider` doc comment path `convex/screening/registry.ts` → `convex/creditRisk/registry.ts`.

- [ ] **Step 9: Update `convex/_generated/api.d.ts`** — rename the 7 `screening/*` import lines and `fullApi` entries to `creditRisk/*` (alphabetical position is identical — `creditRisk` sorts between `contracts` and `crons`, so the block MOVES from after `reserve` to after `contracts`). Keep entries: `creditRisk/actions`, `creditRisk/domain`, `creditRisk/providers/bigdatacorp`, `creditRisk/providers/cpfcnpj`, `creditRisk/providers/mock`, `creditRisk/registry`, `creditRisk/useCases`. (Re-sort both the import block and the `fullApi` map so `creditRisk/*` lands in correct alphabetical order.)

- [ ] **Step 10: Update all moved tests + the contracts test** — in `creditRisk/*.test.ts` and `contracts/useCases.test.ts`: rename `internal.screening.*`→`internal.creditRisk.*`, `runScreening`→`runCreditAnalysis`, table names in `t.run` inserts/queries (`screeningSignals`→`creditRiskSignals`, `screeningAssessments`→`creditRiskAssessments`), drop `purpose` from any assessment insert/query and read `score`/`tier` top-level instead of `result.{score,tier}`, and `decidedAt`→`assessedAt`. The `deriveCreditAnalysis` test asserts the flattened return (`{status:"ok", score, tier}`).

- [ ] **Step 11: Verify green (authoritative)**

```bash
bun run typecheck -- --force      # expect: Tasks 6 successful, 0 error TS
bun --filter @mutav/agency test convex/creditRisk/ convex/contracts/useCases.test.ts   # all pass
grep -rn "screening\|Screening" convex apps --include='*.ts' --include='*.tsx'   # expect: ZERO hits
```
The grep MUST return nothing — any hit is a missed reference.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "refactor(creditRisk): rename screening domain to creditRisk; trim assessment to credit-analysis"
```

---

## Task 2: Docs + final verification

**Files:** move `convex/screening/README.md`→`convex/creditRisk/README.md` (done via git mv in Task 1; now update content), `docs/architecture/README.md`.

- [ ] **Step 1: Rewrite `convex/creditRisk/README.md`** — retitle to `creditRisk`, describe it as the **credit-analysis** (default-risk) module: capability-typed providers → `creditRiskSignals` → `creditRiskAssessments` (the "credit analysis": score→tier). State explicitly it is NOT verification (`compliance/`) and NOT the coverage decision (`contracts/`). Note the `screening` name is retired.

- [ ] **Step 2: Update `docs/architecture/README.md`** — rename the `screening` domain-catalog row to `creditRisk`, description: "Credit analysis (default risk) — capability-typed bureau providers → reproducible credit-risk assessments (score→tier). Consumed by contracts underwriting." Point the link at the new README.

- [ ] **Step 3: Final full verification**

```bash
bun run typecheck -- --force   # 6/6
bun run test                   # all packages green
bun run lint                   # 0
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(creditRisk): readme + architecture catalog for the renamed module"
```

---

## After this slice

- PR #188's content is now `creditRisk`, not `screening` — update the PR title/body (or supersede it). Coordinate with the human before merging, since the broader architecture (verification, products, decision) is still in design.
- Next slices (separate plans): A2 products catalog · A3 compliance/verification module · A4 contracts composition + coverageDecisions (+ the `processingBasisRecords` basis seam written here) · B1 tenantOutcomes capture.

## Self-review

- **Spec coverage:** A1 = rename (D6) + trim (D12 — decision leaves the assessment). Compliance substrate explicitly deferred (matches the spec's slice boundaries, refined: basis seam moves to A4). ✓
- **Placeholder scan:** none — mapping table + exact schema/derivation/consumer code provided. ✓
- **Type consistency:** `deriveCreditAnalysis` flattened return matches the `creditRiskAssessments` `score?`/`tier?` columns and the `recordAssessment` args and the `getCachedCreditScore` read. `runCreditAnalysis` arg set (no purpose) matches `requestCreditScore`'s scheduler call. ✓
- **Atomicity caveat** called out so no broken intermediate commit. ✓
