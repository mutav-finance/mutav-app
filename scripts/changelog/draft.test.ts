/**
 * Unit tests for the pure functions in draft.ts.
 *
 * Scope: slug derivation from branch names, category inference from
 * conventional-commit prefixes, and summary synthesis from PR title + commit
 * subjects. The CLI entrypoint + git/gh shell-outs are integration surface.
 */

import { describe, expect, test } from "vitest";
import { deriveSlug, inferCategoryFromSubjects, synthesizeSummary } from "./draft";

describe("deriveSlug — branch → filename slug", () => {
  test("strips conventional-commit prefix and keeps the remainder", () => {
    expect(deriveSlug("feat/tenant-registry-cascade")).toBe("tenant-registry-cascade");
  });

  test("strips fix/, refactor/, perf/, chore/, docs/, test/", () => {
    expect(deriveSlug("fix/invoice-overdue-derivation")).toBe("invoice-overdue-derivation");
    expect(deriveSlug("refactor/agency-wizard-fields")).toBe("agency-wizard-fields");
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

describe("inferCategoryFromSubjects — majority vote across commit subjects", () => {
  test("returns the majority category with a clear winner", () => {
    expect(inferCategoryFromSubjects(["feat(x): a", "refactor(x): b", "feat(y): c"])).toBe("feat");
  });

  test("tie-break order: feat > fix > refactor > perf > chore > docs > test", () => {
    expect(inferCategoryFromSubjects(["feat(x): a", "fix(y): b"])).toBe("feat");
    expect(inferCategoryFromSubjects(["fix(x): a", "refactor(y): b"])).toBe("fix");
    expect(inferCategoryFromSubjects(["perf(x): a", "chore(y): b"])).toBe("perf");
    expect(inferCategoryFromSubjects(["docs(x): a", "test(y): b"])).toBe("docs");
  });

  test("falls back to 'chore' when the list is empty or matches nothing", () => {
    expect(inferCategoryFromSubjects([])).toBe("chore");
    expect(inferCategoryFromSubjects(["random subject", "wip"])).toBe("chore");
  });

  test("ignores non-conventional subjects when computing the majority", () => {
    expect(inferCategoryFromSubjects(["feat(x): a", "feat(y): b", "wip: something"])).toBe("feat");
  });

  test("handles the breaking-change bang without misclassifying the category", () => {
    expect(inferCategoryFromSubjects(["feat(x)!: breaking change", "fix(y): b"])).toBe("feat");
  });
});

describe("synthesizeSummary — one-line synthesis, PR title preferred", () => {
  test("uses the PR title (prefix-stripped) when present", () => {
    expect(
      synthesizeSummary({
        commitSubjects: ["feat(x): add thing"],
        prTitle: "feat(harness): tenant registry cascade",
      }),
    ).toBe("tenant registry cascade");
  });

  test("falls back to the most recent commit subject when no PR title", () => {
    expect(
      synthesizeSummary({
        commitSubjects: ["feat(x): add thing"],
        prTitle: null,
      }),
    ).toBe("add thing");
  });

  test("keeps non-conventional subjects unchanged (no prefix to strip)", () => {
    expect(
      synthesizeSummary({
        commitSubjects: ["wip: hack around thing"],
        prTitle: null,
      }),
    ).toBe("wip: hack around thing");
  });

  test("marks breaking-change titles with a leading `!`", () => {
    expect(
      synthesizeSummary({
        commitSubjects: [],
        prTitle: "feat(x)!: rework API",
      }),
    ).toBe("! rework API");
  });

  test("emits TBD when nothing is available", () => {
    expect(
      synthesizeSummary({
        commitSubjects: [],
        prTitle: null,
      }).toLowerCase(),
    ).toContain("tbd");
  });
});
