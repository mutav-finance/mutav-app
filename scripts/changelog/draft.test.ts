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

describe("composeBody.whatChanged — one-line synthesis, no commit log", () => {
  test("uses the PR title (prefix-stripped) when a PR exists — no commit bullets", () => {
    const body = composeBody({
      commits: [
        { subject: "feat(x): add thing", body: "" },
        { subject: "fix(y): fix bug", body: "" },
      ],
      prInfo: { number: 42, title: "feat(harness): tenant registry cascade", body: "", url: "" },
    });
    expect(body.whatChanged).toBe("tenant registry cascade");
    // Commits are on the PR — do not duplicate them here.
    expect(body.whatChanged).not.toContain("add thing");
    expect(body.whatChanged).not.toContain("fix bug");
  });

  test("falls back to the first non-empty commit subject when no PR is open", () => {
    const body = composeBody({
      commits: [{ subject: "feat(x): add thing", body: "" }],
      prInfo: null,
    });
    expect(body.whatChanged).toBe("add thing");
  });

  test("keeps non-conventional subjects unchanged (no prefix to strip)", () => {
    const body = composeBody({
      commits: [{ subject: "wip: hack around thing", body: "" }],
      prInfo: null,
    });
    expect(body.whatChanged).toBe("wip: hack around thing");
  });

  test("marks breaking-change titles with a leading `!`", () => {
    const body = composeBody({
      commits: [],
      prInfo: { number: 1, title: "feat(x)!: rework API", body: "", url: "" },
    });
    expect(body.whatChanged).toBe("! rework API");
  });

  test("emits TBD when no PR title and no commit subject exist", () => {
    const body = composeBody({ commits: [], prInfo: null });
    expect(body.whatChanged.toLowerCase()).toContain("tbd");
  });
});

describe("composeBody.notesForAgents — extract from PR body, never pool", () => {
  test("extracts a `## Notes for future agents` section from the PR body", () => {
    const prBody = [
      "## Summary",
      "Big feature.",
      "",
      "## Notes for future agents",
      "The migration deploy-order matters — schema narrow lands in PR 2.",
      "",
      "## Test plan",
      "- [x] tests pass",
    ].join("\n");
    const body = composeBody({
      commits: [],
      prInfo: { number: 1, title: "T", body: prBody, url: "" },
    });
    expect(body.notesForAgents).toContain("The migration deploy-order matters");
    // Sections outside the Notes block must not leak in.
    expect(body.notesForAgents).not.toContain("tests pass");
    expect(body.notesForAgents).not.toContain("Big feature");
  });

  test("accepts `## Notes`, `## Rationale`, `## Why`, `## Why this shape` as fallback headings", () => {
    for (const heading of ["Notes", "Rationale", "Why", "Why this shape"]) {
      const body = composeBody({
        commits: [],
        prInfo: {
          number: 1,
          title: "T",
          body: `## ${heading}\nContent for ${heading}.\n`,
          url: "",
        },
      });
      expect(body.notesForAgents).toContain(`Content for ${heading}.`);
    }
  });

  test("never pools raw commit bodies — commits live on the PR, not in the entry", () => {
    const body = composeBody({
      commits: [
        {
          subject: "feat(x): a",
          body: "Long commit body — must NOT appear verbatim in notes.",
        },
      ],
      prInfo: null,
    });
    expect(body.notesForAgents).not.toContain("must NOT appear");
    expect(body.notesForAgents.toLowerCase()).toContain("tbd");
  });

  test("never pools the PR body verbatim when no Notes-shaped heading exists", () => {
    const body = composeBody({
      commits: [],
      prInfo: {
        number: 1,
        title: "T",
        body: "## Summary\nOnly a summary here.\n## Test plan\n- [x] done",
        url: "",
      },
    });
    expect(body.notesForAgents).not.toContain("Only a summary here.");
    expect(body.notesForAgents).not.toContain("Test plan");
    expect(body.notesForAgents.toLowerCase()).toContain("tbd");
  });

  test("strips git trailers from the extracted section", () => {
    const prBody = [
      "## Notes for future agents",
      "Real content the agent needs.",
      "",
      "Co-authored-by: Bot <bot@example.com>",
      "Signed-off-by: Reviewer",
    ].join("\n");
    const body = composeBody({
      commits: [],
      prInfo: { number: 1, title: "T", body: prBody, url: "" },
    });
    expect(body.notesForAgents).toContain("Real content the agent needs.");
    expect(body.notesForAgents).not.toContain("Co-authored-by");
    expect(body.notesForAgents).not.toContain("Signed-off-by");
  });

  test("TBD prompt tells the author where to write the notes for pickup", () => {
    const body = composeBody({ commits: [], prInfo: null });
    expect(body.notesForAgents.toLowerCase()).toContain("tbd");
    expect(body.notesForAgents).toContain("Notes for future agents");
  });
});
