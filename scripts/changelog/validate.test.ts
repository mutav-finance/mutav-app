/**
 * Tests for scripts/changelog/validate.ts.
 *
 * Fixtures are inline markdown constants — one per case the validator has
 * to discriminate against. Frontmatter-only entries (no body sections).
 */

import { describe, expect, test } from "vitest";

import { isNonTrivialDiff, validate } from "./validate";

const VALID_FEAT = `---
pr: 42
branch: feat/agentic-changelog-harness
merged_at: "2026-07-18"
category: feat
summary: agent-facing changelog harness
sync_actions:
  - kind: install
    detail: "bun install"
  - kind: run
    detail: "bunx husky"
---
`;

const VALID_FIX = `---
branch: fix/invoice-overdue
category: fix
summary: invoice overdue derivation
sync_actions: []
---
`;

const VALID_UNMERGED = `---
pr: unmerged
branch: feat/foo
category: feat
summary: foo
sync_actions: []
---
`;

const MISSING_SUMMARY = `---
branch: feat/foo
category: feat
sync_actions: []
---
`;

const INVALID_KIND = `---
branch: feat/foo
category: feat
summary: foo
sync_actions:
  - kind: bogus
    detail: "does not exist"
---
`;

const INVALID_CATEGORY = `---
branch: feat/foo
category: made-up
summary: foo
sync_actions: []
---
`;

describe("validate()", () => {
  test("accepts a valid feat entry with sync_actions", () => {
    const result = validate(VALID_FEAT);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.category).toBe("feat");
    expect(result.data.branch).toBe("feat/agentic-changelog-harness");
    expect(result.data.summary).toBe("agent-facing changelog harness");
    expect(result.data.pr).toBe(42);
    expect(result.data.sync_actions).toHaveLength(2);
  });

  test("accepts a valid fix entry with no sync_actions", () => {
    const result = validate(VALID_FIX);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.category).toBe("fix");
    expect(result.data.sync_actions).toHaveLength(0);
  });

  test("accepts `pr: unmerged` as a valid PR field", () => {
    const result = validate(VALID_UNMERGED);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.pr).toBe("unmerged");
  });

  test("rejects an entry missing the required `summary` field", () => {
    const result = validate(MISSING_SUMMARY);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("MISSING_FIELD");
  });

  test("rejects a sync_action with an invalid kind", () => {
    const result = validate(INVALID_KIND);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_KIND");
  });

  test("rejects an entry with a category outside the enum", () => {
    const result = validate(INVALID_CATEGORY);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_CATEGORY");
  });

  test("rejects a file that does not start with a `---` fence", () => {
    const result = validate("no frontmatter here\n");
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe("INVALID_FRONTMATTER");
  });

  test("normalizes CRLF line endings before parsing (Windows-authored files)", () => {
    const crlf = VALID_FEAT.replace(/\n/g, "\r\n");
    const result = validate(crlf);
    expect(result.success).toBe(true);
  });

  test("sorts sync_actions deterministically by SYNC_ACTION_ORDER + detail", () => {
    const unsorted = `---
branch: feat/foo
category: feat
summary: foo
sync_actions:
  - kind: run
    detail: "z"
  - kind: env
    detail: "a"
  - kind: install
    detail: "b"
---
`;
    const result = validate(unsorted);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sync_actions.map((a) => a.kind)).toEqual(["env", "install", "run"]);
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
 * asserting all three copies agree — drift causes visible bugs (sync-notice
 * banner order differs from persisted markdown order).
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
