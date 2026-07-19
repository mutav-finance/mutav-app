/**
 * Pure detector tests — one fixture per row of the sync-action detector
 * table (env, install, seed, migrate, run). Each detector is exercised in
 * isolation off a synthetic FileDiff[]; we never call detectSignals()
 * itself because that shells out to git.
 */

import { describe, expect, test } from "vitest";
import {
  detectEnvSignals,
  detectInstallSignal,
  detectMigrateSignal,
  detectRunSignals,
  detectSeedSignal,
  runDetectors,
  type FileDiff,
} from "./signals";

const CONVEX_ENV_SYNC_HINT = "bun run convex:env:sync";

function modified(path: string, addedLines: string[] = []): FileDiff {
  return { path, status: "M", addedLines };
}

function added(path: string, addedLines: string[] = []): FileDiff {
  return { path, status: "A", addedLines };
}

describe("detectEnvSignals — env-file changes", () => {
  test("no env file in diff -> no signal", () => {
    const diffs = [modified("apps/agency/src/app/page.tsx", ["+ hello"])];
    expect(detectEnvSignals(diffs)).toEqual([]);
  });

  test("added var in .env.example is captured by name", () => {
    const diffs = [modified(".env.example", ["NEW_TOKEN=changeme"])];
    const [signal] = detectEnvSignals(diffs);
    expect(signal).toEqual({
      kind: "env",
      detail: `Set NEW_TOKEN in .env.local, then \`${CONVEX_ENV_SYNC_HINT}\``,
    });
  });

  test("added getEnv() call in convex/lib/env.ts is captured", () => {
    const diffs = [modified("convex/lib/env.ts", ['  const foo = getEnv("RESEND_API_KEY");'])];
    const [signal] = detectEnvSignals(diffs);
    expect(signal?.detail).toContain("RESEND_API_KEY");
  });

  test("multiple vars are alphabetized and deduped", () => {
    const diffs = [
      modified(".env.example", ["B_VAR=1", "A_VAR=2"]),
      modified("apps/agency/src/lib/env.ts", ["process.env.A_VAR;", "process.env.C_VAR;"]),
    ];
    const [signal] = detectEnvSignals(diffs);
    expect(signal?.detail).toBe(
      `Set A_VAR, B_VAR, C_VAR in .env.local, then \`${CONVEX_ENV_SYNC_HINT}\``,
    );
  });

  test("env file touched with no extractable var falls back to review nudge", () => {
    const diffs = [modified("convex/lib/env.ts", ["// tidy up comments"])];
    const [signal] = detectEnvSignals(diffs);
    expect(signal?.detail).toBe(
      `Review env changes in convex/lib/env.ts, then \`${CONVEX_ENV_SYNC_HINT}\``,
    );
  });
});

describe("detectInstallSignal — package.json / bun.lock", () => {
  test("no package/lock in diff -> null", () => {
    expect(detectInstallSignal([modified("README.md")])).toBeNull();
  });

  test("package.json change -> bun install", () => {
    expect(detectInstallSignal([modified("package.json")])).toEqual({
      kind: "install",
      detail: "bun install",
    });
  });

  test("bun.lock change alone still triggers", () => {
    expect(detectInstallSignal([modified("bun.lock")])).toEqual({
      kind: "install",
      detail: "bun install",
    });
  });

  test("nested package.json (apps/agency/package.json) does not match", () => {
    expect(detectInstallSignal([modified("apps/agency/package.json")])).toBeNull();
  });
});

describe("detectSeedSignal — convex/seed.ts or schema+domain combo", () => {
  test("no relevant files -> null", () => {
    expect(detectSeedSignal([modified("apps/agency/src/app/page.tsx")])).toBeNull();
  });

  test("convex/seed.ts touched -> bun run seed", () => {
    expect(detectSeedSignal([modified("convex/seed.ts")])).toEqual({
      kind: "seed",
      detail: "bun run seed",
    });
  });

  test("convex/seed.test.ts also triggers the seed signal", () => {
    expect(detectSeedSignal([modified("convex/seed.test.ts")])).toEqual({
      kind: "seed",
      detail: "bun run seed",
    });
  });

  test("schema.ts alone (no domain edit) does not trigger", () => {
    expect(detectSeedSignal([modified("convex/schema.ts")])).toBeNull();
  });

  test("domain.ts alone (no schema edit) does not trigger", () => {
    expect(detectSeedSignal([modified("convex/contracts/domain.ts")])).toBeNull();
  });

  test("schema.ts + domain.ts together trigger the schema-shape nudge", () => {
    const diffs = [modified("convex/schema.ts"), modified("convex/contracts/domain.ts")];
    expect(detectSeedSignal(diffs)).toEqual({
      kind: "seed",
      detail: "bun run seed (schema-shape change alongside a convex/*/domain.ts edit)",
    });
  });
});

describe("detectMigrateSignal — new runner entry in convex/migrations.ts", () => {
  test("migrations.ts not touched -> null", () => {
    expect(detectMigrateSignal([modified("convex/schema.ts")])).toBeNull();
  });

  test("migrations.ts touched but no new runner entry -> null", () => {
    const diffs = [modified("convex/migrations.ts", ["// harmless comment change"])];
    expect(detectMigrateSignal(diffs)).toBeNull();
  });

  test("new runner entry inside runAll is captured", () => {
    const diffs = [
      modified("convex/migrations.ts", [
        "export const runAll = migrations.runner([",
        "  internal.migrations.backfillTenantIds,",
        "]);",
      ]),
    ];
    expect(detectMigrateSignal(diffs)).toEqual({
      kind: "migrate",
      detail:
        "New migration(s) added to runAll: backfillTenantIds — auto-runs on `bunx convex dev`",
    });
  });

  test("noop runner entries are ignored", () => {
    const diffs = [
      modified("convex/migrations.ts", [
        "export const runAll = migrations.runner([",
        "  internal.migrations.noop,",
        "]);",
      ]),
    ];
    expect(detectMigrateSignal(diffs)).toBeNull();
  });

  test("multiple runner entries are sorted alphabetically", () => {
    const diffs = [
      modified("convex/migrations.ts", [
        "export const runAll = migrations.runner([",
        "  internal.migrations.zebra,",
        "  internal.migrations.alpha,",
        "]);",
      ]),
    ];
    expect(detectMigrateSignal(diffs)?.detail).toBe(
      "New migration(s) added to runAll: alpha, zebra — auto-runs on `bunx convex dev`",
    );
  });
});

describe("detectRunSignals — new scripts/*.ts + matching package.json script", () => {
  test("no new script -> no signal", () => {
    expect(detectRunSignals([modified("README.md")])).toEqual([]);
  });

  test("modified (not added) scripts/*.ts does not trigger", () => {
    const diffs = [
      modified("scripts/etherfuse-smoke.ts", ["+ // tweak"]),
      modified("package.json", ['"etherfuse:smoke": "bun run scripts/etherfuse-smoke.ts"']),
    ];
    expect(detectRunSignals(diffs)).toEqual([]);
  });

  test("added script without a matching package.json entry -> no signal", () => {
    const diffs = [added("scripts/new-thing.ts", ["export function main() {}"])];
    expect(detectRunSignals(diffs)).toEqual([]);
  });

  test("added script + new package.json script pointing at it -> run entry", () => {
    const diffs = [
      added("scripts/new-thing.ts", ["export function main() {}"]),
      modified("package.json", ['    "new-thing": "bun run scripts/new-thing.ts",']),
    ];
    expect(detectRunSignals(diffs)).toEqual([{ kind: "run", detail: "bun run new-thing" }]);
  });

  test("multiple new scripts each produce one run entry, sorted", () => {
    const diffs = [
      added("scripts/beta.ts"),
      added("scripts/alpha.ts"),
      modified("package.json", [
        '    "beta": "bun run scripts/beta.ts",',
        '    "alpha": "bun run scripts/alpha.ts",',
      ]),
    ];
    expect(detectRunSignals(diffs)).toEqual([
      { kind: "run", detail: "bun run alpha" },
      { kind: "run", detail: "bun run beta" },
    ]);
  });
});

describe("runDetectors — combined pipeline ordering", () => {
  test("emits actions in env → install → seed → migrate → run order", () => {
    const diffs = [
      added("scripts/probe.ts"),
      modified("package.json", ['    "probe": "bun run scripts/probe.ts",']),
      modified("convex/seed.ts", ["// touched"]),
      modified(".env.example", ["NEW_TOKEN=1"]),
      modified("convex/migrations.ts", [
        "export const runAll = migrations.runner([",
        "  internal.migrations.newOne,",
        "]);",
      ]),
    ];
    const actions = runDetectors(diffs);
    expect(actions.map((a) => a.kind)).toEqual(["env", "install", "seed", "migrate", "run"]);
  });

  test("empty diff produces no actions", () => {
    expect(runDetectors([])).toEqual([]);
  });

  test("never emits the 'manual' kind (drafter-only)", () => {
    const diffs = [
      modified(".env.example", ["A=1"]),
      modified("package.json"),
      modified("convex/seed.ts"),
      modified("convex/migrations.ts", ["  internal.migrations.foo,"]),
    ];
    const actions = runDetectors(diffs);
    expect(actions.some((a) => a.kind === "manual")).toBe(false);
  });
});
