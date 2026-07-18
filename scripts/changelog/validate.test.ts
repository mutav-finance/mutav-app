/**
 * Tests for scripts/changelog/validate.ts.
 *
 * Fixtures are inline markdown string constants — one per category the
 * validator has to discriminate against. Each fixture exercises the
 * frontmatter parser, the Zod schema, and the body-section extractor
 * end-to-end via `validate()`.
 *
 * Fixture matrix:
 *   1. VALID_FEAT       — happy path, category=feat, sync_actions present
 *   2. VALID_FIX        — happy path, category=fix, no sync_actions
 *   3. MISSING_SYNC     — frontmatter omits sync_actions entirely
 *   4. INVALID_KIND     — sync_actions[0].kind is not in SYNC_ACTION_KINDS
 *   5. INVALID_CATEGORY — category is not in CATEGORIES
 *   6. DOCS_ONLY        — category=docs, still valid (docs entries are allowed)
 *
 * Also covers isNonTrivialDiff() for the three canonical paths the sensor
 * has to classify (docs, notes, real code).
 */

import { describe, expect, test } from "vitest";

import { isNonTrivialDiff, validate } from "./validate";

const VALID_FEAT = `---
pr: 42
branch: feat/agentic-changelog-harness
merged_at: "2026-07-18"
category: feat
scopes: [changelog, harness]
breaking: false
sync_actions:
  - kind: install
    detail: bun install
  - kind: migrate
    detail: bunx convex run migrations:runAll
touched_domains: [changelog, hooks]
issue_refs: [MUTAV-123]
---

## What changed

Introduced the agent-facing changelog harness with validate + draft scripts.

## Notes for future agents

Run \`bun run changelog:validate\` before pushing — the husky pre-push hook enforces it.
`;

const VALID_FIX = `---
pr: 43
branch: fix/contract-status-derivation
category: fix
scopes: [contracts]
breaking: false
sync_actions: []
touched_domains: [contracts]
issue_refs: []
---

## What changed

Fixed the derived contract status when the latest invoice is overdue.

## Notes for future agents

Status derivation lives in convex/contracts/useCases.ts — keep it there.
`;

const MISSING_SYNC = `---
pr: 44
branch: chore/no-sync-actions
category: chore
scopes: [chore]
breaking: false
touched_domains: [chore]
issue_refs: []
---

## What changed

Chore entry missing the required sync_actions field.

## Notes for future agents

This fixture should fail validation with MISSING_FIELD.
`;

const INVALID_KIND = `---
pr: 45
branch: feat/invalid-kind
category: feat
scopes: [changelog]
breaking: false
sync_actions:
  - kind: reboot
    detail: restart the universe
touched_domains: [changelog]
issue_refs: []
---

## What changed

Sync action with an unsupported kind.

## Notes for future agents

The validator must reject any kind outside SYNC_ACTION_KINDS.
`;

const INVALID_CATEGORY = `---
pr: 46
branch: feat/invalid-category
category: banana
scopes: [changelog]
breaking: false
sync_actions: []
touched_domains: [changelog]
issue_refs: []
---

## What changed

Category is not in the CATEGORIES union.

## Notes for future agents

The validator must reject unknown categories.
`;

const DOCS_ONLY = `---
pr: 47
branch: docs/changelog-harness
category: docs
scopes: [docs]
breaking: false
sync_actions: []
touched_domains: [docs]
issue_refs: []
---

## What changed

Documented the changelog harness in docs/superpowers/specs/.

## Notes for future agents

Docs-only entries are valid — the category is allowed.
`;

describe("validate()", () => {
  test("accepts a valid feat entry and normalizes sync_actions", () => {
    const result = validate(VALID_FEAT);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.category).toBe("feat");
    expect(result.data.pr).toBe(42);
    expect(result.data.branch).toBe("feat/agentic-changelog-harness");
    expect(result.data.merged_at).toBe("2026-07-18");
    expect(result.data.sync_actions).toEqual([
      { kind: "install", detail: "bun install" },
      { kind: "migrate", detail: "bunx convex run migrations:runAll" },
    ]);
    expect(result.data.body.whatChanged.length).toBeGreaterThan(0);
    expect(result.data.body.notesForAgents.length).toBeGreaterThan(0);
  });

  test("accepts a valid fix entry with empty sync_actions", () => {
    const result = validate(VALID_FIX);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.category).toBe("fix");
    expect(result.data.sync_actions).toEqual([]);
    expect(result.data.pr).toBe(43);
  });

  test("rejects an entry missing the sync_actions field", () => {
    const result = validate(MISSING_SYNC);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.code).toBe("MISSING_FIELD");
    expect(result.error.field).toBe("sync_actions");
  });

  test("rejects an entry with an invalid sync_action kind", () => {
    const result = validate(INVALID_KIND);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.code).toBe("INVALID_KIND");
    expect(result.error.field).toContain("sync_actions");
    expect(result.error.field).toContain("kind");
  });

  test("rejects an entry with an invalid category", () => {
    const result = validate(INVALID_CATEGORY);
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.code).toBe("INVALID_CATEGORY");
    expect(result.error.field).toBe("category");
  });

  test("accepts a docs-only entry", () => {
    const result = validate(DOCS_ONLY);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.category).toBe("docs");
    expect(result.data.sync_actions).toEqual([]);
  });
});

describe("isNonTrivialDiff()", () => {
  test("returns false for a docs-only diff", () => {
    expect(isNonTrivialDiff("docs/foo.md")).toBe(false);
  });

  test("returns false for a .claude/notes-only diff", () => {
    expect(isNonTrivialDiff(".claude/notes/foo.md")).toBe(false);
  });

  test("returns true for a real code change", () => {
    expect(isNonTrivialDiff("convex/contracts/useCases.ts")).toBe(true);
  });
});

/**
 * SYNC_ACTION_ORDER is duplicated across three files by design (types.ts is
 * TS-only; sync-notice.mjs and .claude/hooks/changelog-sync-notice.js are
 * plain JS so they can run without a build step). Guard the duplication by
 * asserting all three copies agree — a drift causes visible bugs
 * (sync-notice banner order differs from persisted markdown order).
 */
describe("SYNC_ACTION_ORDER alignment", () => {
  test("types.ts / sync-notice.mjs / SessionStart hook all use the same order", async () => {
    const { readFileSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    const here = dirname(fileURLToPath(import.meta.url));
    const repoRoot = join(here, "..", "..");

    const files = [
      join(here, "types.ts"),
      join(here, "sync-notice.mjs"),
      join(repoRoot, ".claude", "hooks", "changelog-sync-notice.js"),
    ];

    const extractOrder = (source: string): Record<string, number> => {
      const match = source.match(/SYNC_ACTION_ORDER[^{]*\{([\s\S]*?)\}/);
      if (!match) throw new Error("SYNC_ACTION_ORDER block not found");
      const body = match[1] ?? "";
      const entries: Record<string, number> = {};
      for (const line of body.split("\n")) {
        const kv = line.match(/([a-z]+)\s*:\s*(\d+)/);
        if (!kv) continue;
        const kind = kv[1];
        const rank = kv[2];
        if (kind && rank !== undefined) entries[kind] = Number(rank);
      }
      return entries;
    };

    const orders = files.map((file) => extractOrder(readFileSync(file, "utf8")));
    const [reference, ...rest] = orders;
    for (const other of rest) {
      expect(other).toEqual(reference);
    }
  });
});
