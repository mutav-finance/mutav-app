/**
 * Unit tests for the pure functions in draft.ts.
 *
 * Deliberately narrow scope: slug derivation, category inference, scope /
 * touched_domain extraction from file paths, and body composition. The CLI
 * entrypoint and git/gh shell-outs are integration surface and belong in a
 * separate harness — not here.
 */

import { describe, expect, test } from "vitest";
import { composeBody, deriveSlug, extractScopes, inferCategory } from "./draft";

describe("deriveSlug — branch → filename slug", () => {
  test("strips conventional-commit prefix and keeps the remainder", () => {
    expect(deriveSlug("feat/tenant-registry-cascade")).toBe("tenant-registry-cascade");
  });

  test("strips fix/ prefix", () => {
    expect(deriveSlug("fix/invoice-overdue-derivation")).toBe("invoice-overdue-derivation");
  });

  test("strips refactor/ prefix", () => {
    expect(deriveSlug("refactor/agency-wizard-fields")).toBe("agency-wizard-fields");
  });

  test("strips perf/, chore/, docs/, test/ prefixes", () => {
    expect(deriveSlug("perf/memoize-step-indicator")).toBe("memoize-step-indicator");
    expect(deriveSlug("chore/bump-next")).toBe("bump-next");
    expect(deriveSlug("docs/architecture-readme")).toBe("architecture-readme");
    expect(deriveSlug("test/pending-entry-parser")).toBe("pending-entry-parser");
  });

  test("normalises nested slashes into dashes", () => {
    expect(deriveSlug("feat/foo/bar/baz")).toBe("foo-bar-baz");
  });

  test("leaves branches without a known prefix intact (minus slashes)", () => {
    expect(deriveSlug("hoffms/experiment")).toBe("hoffms-experiment");
  });

  test("passes through a plain branch name unchanged", () => {
    expect(deriveSlug("main")).toBe("main");
  });
});

describe("inferCategory — majority vote across commit subjects", () => {
  test("returns the majority category with a clear winner", () => {
    expect(inferCategory(["feat(x): a", "refactor(x): b", "feat(y): c"])).toBe("feat");
  });

  test("tie-break order: feat > fix > refactor > perf > chore > docs > test", () => {
    // 1 feat + 1 fix → feat wins (higher precedence)
    expect(inferCategory(["feat(x): a", "fix(y): b"])).toBe("feat");
    // 1 fix + 1 refactor → fix wins
    expect(inferCategory(["fix(x): a", "refactor(y): b"])).toBe("fix");
    // 1 perf + 1 chore → perf wins
    expect(inferCategory(["perf(x): a", "chore(y): b"])).toBe("perf");
    // 1 docs + 1 test → docs wins
    expect(inferCategory(["docs(x): a", "test(y): b"])).toBe("docs");
  });

  test("falls back to 'chore' when the list is empty", () => {
    expect(inferCategory([])).toBe("chore");
  });

  test("falls back to 'chore' when no subject matches the conventional-commit shape", () => {
    expect(inferCategory(["random subject", "another one", "wip"])).toBe("chore");
  });

  test("ignores non-conventional subjects when computing the majority", () => {
    // Two feat + one non-conventional → feat still wins
    expect(inferCategory(["feat(x): a", "feat(y): b", "wip: something"])).toBe("feat");
  });

  test("handles the breaking-change bang without misclassifying the category", () => {
    expect(inferCategory(["feat(x)!: breaking change", "fix(y): b"])).toBe("feat");
  });
});

describe("extractScopes — file paths → touched domains", () => {
  test("groups changed paths into their coarse domain buckets", () => {
    expect(extractScopes(["convex/contracts/useCases.ts", "apps/agency/src/foo.tsx"])).toEqual([
      "apps/agency",
      "convex/contracts",
    ]);
  });

  test("returns a sorted, deduplicated list", () => {
    expect(
      extractScopes([
        "apps/agency/src/foo.tsx",
        "apps/agency/src/bar.tsx",
        "convex/contracts/useCases.ts",
        "convex/contracts/domain.ts",
      ]),
    ).toEqual(["apps/agency", "convex/contracts"]);
  });

  test("collapses top-level convex files under a single 'convex' bucket", () => {
    expect(extractScopes(["convex/schema.ts", "convex/seed.ts"])).toEqual(["convex"]);
  });

  test("recognises packages/<name> and apps/<name>", () => {
    expect(extractScopes(["packages/ui/src/button.tsx", "apps/pay/src/page.tsx"])).toEqual([
      "apps/pay",
      "packages/ui",
    ]);
  });

  test("buckets docs/, scripts/, .claude/, .husky/, .github/ at their top level", () => {
    expect(
      extractScopes([
        "docs/architecture/README.md",
        "scripts/changelog/draft.ts",
        ".claude/hooks/no-brand-edit.js",
        ".husky/pre-commit",
        ".github/workflows/ci.yml",
      ]),
    ).toEqual([".claude", ".github", ".husky", "docs", "scripts"]);
  });

  test("returns [] for an empty input", () => {
    expect(extractScopes([])).toEqual([]);
  });
});

describe("composeBody — What changed / Notes for future agents", () => {
  test("renders commit subjects as a bullet list under 'What changed'", () => {
    const body = composeBody({
      commits: [
        { subject: "feat(x): add thing", body: "" },
        { subject: "fix(y): fix bug", body: "" },
      ],
      prInfo: null,
    });
    expect(body.whatChanged).toContain("- feat(x): add thing");
    expect(body.whatChanged).toContain("- fix(y): fix bug");
  });

  test("prepends the PR title to 'What changed' when a PR is supplied", () => {
    const body = composeBody({
      commits: [{ subject: "feat(x): add thing", body: "" }],
      prInfo: { number: 42, title: "Add tenant registry", body: "", url: "" },
    });
    expect(body.whatChanged.startsWith("Add tenant registry")).toBe(true);
    expect(body.whatChanged).toContain("- feat(x): add thing");
  });

  test("joins commit bodies + PR body into 'Notes for future agents'", () => {
    const body = composeBody({
      commits: [
        { subject: "feat(x): a", body: "Non-obvious constraint: X." },
        { subject: "fix(y): b", body: "" },
      ],
      prInfo: { number: 1, title: "T", body: "PR-level rationale here.", url: "" },
    });
    expect(body.notesForAgents).toContain("PR-level rationale here.");
    expect(body.notesForAgents).toContain("Non-obvious constraint: X.");
  });

  test("emits placeholder text when no raw material is available", () => {
    const body = composeBody({ commits: [], prInfo: null });
    expect(body.whatChanged.toLowerCase()).toContain("tbd");
    expect(body.notesForAgents.toLowerCase()).toContain("tbd");
  });

  test("does not invent notes when commit bodies and PR body are all empty", () => {
    const body = composeBody({
      commits: [{ subject: "feat(x): a", body: "" }],
      prInfo: { number: 1, title: "T", body: "", url: "" },
    });
    // What changed still populated from subjects + title.
    expect(body.whatChanged).toContain("- feat(x): a");
    // Notes falls back to the TBD placeholder — never fabricated.
    expect(body.notesForAgents.toLowerCase()).toContain("tbd");
  });
});
