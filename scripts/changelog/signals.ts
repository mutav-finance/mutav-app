/**
 * Filesystem-signal detectors — the trust anchor for `sync_actions[]`.
 *
 * Given a diff of `main...HEAD` (or an arbitrary baseRef), each detector
 * fires deterministically off the file paths and added lines it inspects.
 * The drafter combines these SyncAction[] with LLM-generated body sections.
 *
 * The detectors are shape-driven: each takes a `FileDiff[]` synthetic diff
 * and returns SyncAction(s) — they never shell out. `detectSignals()` is
 * the only function that talks to git; it builds the FileDiff[] and hands
 * it to the pure detectors, which keeps the detector logic testable in
 * isolation.
 *
 * See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md
 * for the detector table.
 */

import { execFileSync } from "node:child_process";
import { SYNC_ACTION_ORDER, type SyncAction } from "./types";

const DEFAULT_BASE_REF = "origin/main";

const ENV_FILE_PATTERNS: RegExp[] = [
  /^\.env\.example$/,
  /^convex\/lib\/env\.ts$/,
  /^apps\/[^/]+\/src\/lib\/env\.ts$/,
];

const INSTALL_FILE_PATTERNS: RegExp[] = [/^package\.json$/, /^bun\.lock$/];

const SEED_FILE_PATTERNS: RegExp[] = [/^convex\/seed\.ts$/, /^convex\/seed\.test\.ts$/];

const CONVEX_DOMAIN_FILE = /^convex\/[^/]+\/domain\.ts$/;

const CONVEX_SCHEMA_FILE = /^convex\/schema\.ts$/;

const MIGRATIONS_FILE = "convex/migrations.ts";

const SCRIPTS_FILE_PATTERN = /^scripts\/[^/]+\.ts$/;

const HUSKY_FILE_PATTERN = /^\.husky\/(?!_\/)[^/]+$/;

const PACKAGE_JSON_FILE = "package.json";

const CONVEX_ENV_SYNC_COMMAND = "bun run convex:env:sync";

export type FileDiffStatus = "A" | "M" | "D";

/**
 * Synthetic per-file diff. The pure detectors take an array of these and
 * emit SyncAction[] deterministically — no git access. `detectSignals()`
 * builds them from `git diff` in one place; every test supplies literals.
 */
export type FileDiff = {
  path: string;
  status: FileDiffStatus;
  addedLines: string[];
};

export type DetectSignalsOptions = {
  baseRef?: string;
  cwd?: string;
};

/**
 * Runs every detector against the diff between `baseRef` (default
 * `origin/main`) and HEAD, returns the resulting SyncAction[] ordered by
 * SYNC_ACTION_ORDER (env → install → seed → migrate → run → manual).
 *
 * The 'manual' kind is drafter-authored — this function never emits it.
 */
export async function detectSignals(opts: DetectSignalsOptions = {}): Promise<SyncAction[]> {
  const baseRef = opts.baseRef ?? DEFAULT_BASE_REF;
  const cwd = opts.cwd;

  const diffs = buildFileDiffs(baseRef, cwd);
  if (diffs.length === 0) return [];

  return runDetectors(diffs);
}

/**
 * Pure detector pipeline. Exposed for tests and for callers who already
 * have a materialized diff (e.g. GitHub Actions with the merge-base blob).
 */
export function runDetectors(diffs: FileDiff[]): SyncAction[] {
  const actions: SyncAction[] = [];

  actions.push(...detectEnvSignals(diffs));

  const installAction = detectInstallSignal(diffs);
  if (installAction) actions.push(installAction);

  const seedAction = detectSeedSignal(diffs);
  if (seedAction) actions.push(seedAction);

  const migrateAction = detectMigrateSignal(diffs);
  if (migrateAction) actions.push(migrateAction);

  actions.push(...detectRunSignals(diffs));

  return sortActions(actions);
}

// ─── Individual detectors ─────────────────────────────────────────────────────

/**
 * env — fires when `.env.example`, `convex/lib/env.ts`, or an
 * `apps/*\/src/lib/env.ts` was touched. Reports added var names when
 * discoverable; otherwise a generic review nudge.
 */
export function detectEnvSignals(diffs: FileDiff[]): SyncAction[] {
  const envDiffs = diffs.filter((diff) => ENV_FILE_PATTERNS.some((re) => re.test(diff.path)));
  if (envDiffs.length === 0) return [];

  const addedVars = new Set<string>();
  for (const diff of envDiffs) {
    for (const line of diff.addedLines) {
      for (const name of extractEnvVarNames(line)) {
        addedVars.add(name);
      }
    }
  }

  const envPaths = envDiffs.map((diff) => diff.path);

  if (addedVars.size === 0) {
    return [
      {
        kind: "env",
        detail: `Review env changes in ${envPaths.join(", ")}, then \`${CONVEX_ENV_SYNC_COMMAND}\``,
      },
    ];
  }

  const sortedNames = [...addedVars].sort();
  return [
    {
      kind: "env",
      detail: `Set ${sortedNames.join(", ")} in .env.local, then \`${CONVEX_ENV_SYNC_COMMAND}\``,
    },
  ];
}

/**
 * install — fires when `package.json` or `bun.lock` was touched.
 */
export function detectInstallSignal(diffs: FileDiff[]): SyncAction | null {
  const matched = diffs.some((diff) => INSTALL_FILE_PATTERNS.some((re) => re.test(diff.path)));
  if (!matched) return null;
  return { kind: "install", detail: "bun install" };
}

/**
 * seed — fires when `convex/seed.ts` (or its test) was touched, or when a
 * `convex/schema.ts` change lands alongside a `convex/*\/domain.ts` edit.
 */
export function detectSeedSignal(diffs: FileDiff[]): SyncAction | null {
  const seedTouched = diffs.some((diff) => SEED_FILE_PATTERNS.some((re) => re.test(diff.path)));
  if (seedTouched) {
    return { kind: "seed", detail: "bun run seed" };
  }

  const domainTouched = diffs.some((diff) => CONVEX_DOMAIN_FILE.test(diff.path));
  const schemaTouched = diffs.some((diff) => CONVEX_SCHEMA_FILE.test(diff.path));
  if (domainTouched && schemaTouched) {
    return {
      kind: "seed",
      detail: "bun run seed (schema-shape change alongside a convex/*/domain.ts edit)",
    };
  }

  return null;
}

/**
 * migrate — fires when `convex/migrations.ts` was touched AND the added
 * lines register a new runner in `runAll`.
 */
export function detectMigrateSignal(diffs: FileDiff[]): SyncAction | null {
  const migrationsDiff = diffs.find((diff) => diff.path === MIGRATIONS_FILE);
  if (!migrationsDiff) return null;

  const newRunnerEntries = collectNewRunnerEntries(migrationsDiff.addedLines);
  if (newRunnerEntries.length === 0) return null;

  return {
    kind: "migrate",
    detail: `New migration(s) added to runAll: ${newRunnerEntries.join(", ")} — auto-runs on \`bunx convex dev\``,
  };
}

/**
 * run — fires when a brand-new `scripts/*.ts` file lands together with a
 * new `package.json` script entry that references it, or when `.husky/`
 * hooks are added/modified (contributors need `bunx husky` to re-register).
 */
export function detectRunSignals(diffs: FileDiff[]): SyncAction[] {
  const actions: SyncAction[] = [];

  const huskyTouched = diffs.some(
    (diff) => HUSKY_FILE_PATTERN.test(diff.path) && diff.status !== "D",
  );
  if (huskyTouched) {
    actions.push({ kind: "run", detail: "bunx husky" });
  }

  const newScripts = diffs
    .filter((diff) => diff.status === "A" && SCRIPTS_FILE_PATTERN.test(diff.path))
    .map((diff) => diff.path);

  if (newScripts.length > 0) {
    const packageJsonDiff = diffs.find((diff) => diff.path === PACKAGE_JSON_FILE);
    if (packageJsonDiff) {
      const commands = collectNewScriptCommands(packageJsonDiff.addedLines, newScripts);
      for (const command of commands) {
        actions.push({ kind: "run", detail: command });
      }
    }
  }

  return actions;
}

// ─── Diff plumbing ────────────────────────────────────────────────────────────

function buildFileDiffs(baseRef: string, cwd: string | undefined): FileDiff[] {
  const nameStatusOutput = runGit(["diff", "--name-status", `${baseRef}...HEAD`], cwd);
  const rows = nameStatusOutput.split("\n").filter((line) => line.length > 0);

  const diffs: FileDiff[] = [];
  for (const row of rows) {
    const parsed = parseNameStatusRow(row);
    if (!parsed) continue;
    const addedLines = readAddedLines(baseRef, parsed.path, cwd);
    diffs.push({ path: parsed.path, status: parsed.status, addedLines });
  }

  // If nothing is committed vs baseRef yet, return no signals — the drafter
  // is meant to run after commits exist. The bootstrap-moment fallback (fold
  // in the working tree) was removed after the ship-review pass; it had zero
  // test coverage and only served the self-referential bootstrap of this
  // harness. If a real need resurfaces, restore from git history.
  return diffs;
}

/**
 * Parse one row of `git diff --name-status` output. The output is tab-delimited:
 *
 *   M\tpath/to/file.ts
 *   A\tpath/with spaces.ts
 *   R100\told/path.ts\tnew/path.ts   ← rename: report the NEW path
 *
 * Splitting on whitespace (as an earlier version did) drops filenames that
 * contain spaces and confuses rename rows. Split on tab only.
 */
function parseNameStatusRow(row: string): { path: string; status: FileDiffStatus } | null {
  const parts = row.split("\t");
  const rawStatus = parts[0];
  if (!rawStatus || parts.length < 2) return null;

  // Renames + copies emit `R100\told\tnew` / `C075\told\tnew`; the new path
  // is what the rest of the pipeline cares about. Deletes emit `D\tpath`.
  const path = parts[parts.length - 1];
  if (!path || path.length === 0) return null;

  const statusChar = rawStatus[0];
  if (statusChar === "A") return { path, status: "A" };
  if (statusChar === "D") return { path, status: "D" };
  return { path, status: "M" };
}

function readAddedLines(baseRef: string, path: string, cwd: string | undefined): string[] {
  const diff = runGit(["diff", `${baseRef}...HEAD`, "--", path], cwd);
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function runGit(args: string[], cwd: string | undefined): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

// ─── Line parsing ─────────────────────────────────────────────────────────────

const ENV_ASSIGNMENT = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/;
const ENV_TS_GETTER = /getEnv\(\s*["']([A-Z][A-Z0-9_]*)["']/g;
const ENV_TS_PROCESS = /process\.env\.([A-Z][A-Z0-9_]*)/g;

function extractEnvVarNames(line: string): string[] {
  const results = new Set<string>();

  const assignment = line.match(ENV_ASSIGNMENT);
  if (assignment && assignment[1]) results.add(assignment[1]);

  for (const match of line.matchAll(ENV_TS_GETTER)) {
    if (match[1]) results.add(match[1]);
  }
  for (const match of line.matchAll(ENV_TS_PROCESS)) {
    if (match[1]) results.add(match[1]);
  }

  return [...results];
}

const RUNNER_ENTRY_PATTERN = /internal\.migrations\.([A-Za-z_][A-Za-z0-9_]*)/g;

/**
 * Collect names of new runners added to `runAll(...)` in convex/migrations.ts.
 *
 * Strict scoping: we only emit a `migrate` signal when the diff either adds
 * `runAll` itself OR adds an `internal.migrations.<name>` reference on lines
 * that immediately follow a still-open `runAll(` bracket. A previous version
 * fell back to matching any `internal.migrations.*` occurrence in the diff
 * when the strict pass returned nothing — that produced false positives from
 * comments, string literals, and references outside runAll. Simpler win: if
 * runAll wasn't touched at all, there is nothing to auto-run.
 */
function collectNewRunnerEntries(addedLines: string[]): string[] {
  const found = new Set<string>();
  let bracketDepth = 0;
  let inRunAll = false;

  for (const line of addedLines) {
    if (line.includes("runAll")) {
      inRunAll = true;
      bracketDepth = 0;
    }
    if (!inRunAll) continue;

    for (const match of line.matchAll(RUNNER_ENTRY_PATTERN)) {
      const name = match[1];
      if (!name || name === "noop") continue;
      found.add(name);
    }

    // Track parenthesis balance across nested calls so `internal.migrations.foo(getEnv())`
    // doesn't close the runAll scope on the inner `)`.
    for (const ch of line) {
      if (ch === "(") bracketDepth++;
      else if (ch === ")") {
        bracketDepth--;
        if (bracketDepth <= 0) {
          inRunAll = false;
          break;
        }
      }
    }
  }

  return [...found].sort();
}

const PACKAGE_JSON_SCRIPT = /^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*$/;

function collectNewScriptCommands(addedLines: string[], newScripts: string[]): string[] {
  const commands = new Set<string>();
  for (const line of addedLines) {
    const match = line.match(PACKAGE_JSON_SCRIPT);
    if (!match) continue;
    const scriptName = match[1];
    const scriptCommand = match[2];
    if (!scriptName || !scriptCommand) continue;
    if (!newScripts.some((path) => scriptCommand.includes(path))) continue;
    commands.add(`bun run ${scriptName}`);
  }
  return [...commands].sort();
}

// ─── Ordering ─────────────────────────────────────────────────────────────────

function sortActions(actions: SyncAction[]): SyncAction[] {
  return [...actions].sort((a, b) => {
    const kindDelta = SYNC_ACTION_ORDER[a.kind] - SYNC_ACTION_ORDER[b.kind];
    if (kindDelta !== 0) return kindDelta;
    return a.detail.localeCompare(b.detail);
  });
}
