#!/usr/bin/env bun
/**
 * Release workflow for the agent-facing changelog harness.
 *
 * See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md
 * (§ Release workflow) for the design.
 *
 * Usage:
 *
 *   bun run scripts/changelog/release.ts --bump=<patch|minor|major> [--dry-run]
 *
 * What it does (in order):
 *
 *   1. Read every `changelog/pending/*.md`, validate it via validate().
 *      Any invalid entry aborts the whole run — releases are all-or-nothing.
 *   2. Group entries into Keep-a-Changelog sections:
 *        feat            → Added
 *        refactor / perf → Changed
 *        fix             → Fixed
 *        docs            → Documentation
 *        chore / test    → Internal
 *   3. Read root package.json version, compute next per --bump.
 *   4. Compose the release-notes markdown.
 *   5. Write notes to /tmp/changelog-notes.md.
 *   6. Update root package.json version.
 *   7. `git rm changelog/pending/*.md`
 *   8. `git add package.json` + commit `chore(release): v<X.Y.Z>`.
 *   9. `git tag v<X.Y.Z>` and push commit + tag.
 *  10. `gh release create v<X.Y.Z> --title "v<X.Y.Z>" --notes-file /tmp/changelog-notes.md`.
 *
 * --dry-run: prints what would happen at every step but does not mutate any
 * files, does not shell out to git or gh. Used by CI on PRs that touch
 * `changelog/pending/*.md` to catch aggregation errors before merge.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { validate } from "./validate";
import type { Category, Entry, SyncAction } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const PENDING_DIR = join(REPO_ROOT, "changelog", "pending");
const PACKAGE_JSON_PATH = join(REPO_ROOT, "package.json");
const NOTES_PATH = "/tmp/changelog-notes.md";

const BUMP_KINDS = ["patch", "minor", "major"] as const;
type BumpKind = (typeof BUMP_KINDS)[number];

type SectionKey = "Added" | "Changed" | "Fixed" | "Documentation" | "Internal";

const SECTION_ORDER: readonly SectionKey[] = [
  "Added",
  "Changed",
  "Fixed",
  "Documentation",
  "Internal",
];

const CATEGORY_TO_SECTION: Record<Category, SectionKey> = {
  feat: "Added",
  refactor: "Changed",
  perf: "Changed",
  fix: "Fixed",
  docs: "Documentation",
  chore: "Internal",
  test: "Internal",
};

// ─── CLI parsing ──────────────────────────────────────────────────────────────

type CliOptions = {
  bump: BumpKind;
  dryRun: boolean;
};

type CliParseErrorReason = "MISSING_BUMP" | "INVALID_BUMP" | "UNKNOWN_FLAG";

type CliParseError = { reason: CliParseErrorReason; message: string };

function parseCli(argv: readonly string[]): CliOptions | CliParseError {
  let bump: BumpKind | null = null;
  let dryRun = false;

  for (const arg of argv) {
    if (arg.startsWith("--bump=")) {
      const value = arg.slice("--bump=".length);
      if (!isBumpKind(value)) {
        return {
          reason: "INVALID_BUMP",
          message: `--bump must be one of ${BUMP_KINDS.join(", ")}; got "${value}"`,
        };
      }
      bump = value;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    return { reason: "UNKNOWN_FLAG", message: `Unknown flag: ${arg}` };
  }

  if (!bump) {
    return {
      reason: "MISSING_BUMP",
      message: `--bump=<${BUMP_KINDS.join("|")}> is required`,
    };
  }

  return { bump, dryRun };
}

function isBumpKind(value: string): value is BumpKind {
  return (BUMP_KINDS as readonly string[]).includes(value);
}

function isCliParseError(value: CliOptions | CliParseError): value is CliParseError {
  return "reason" in value;
}

// ─── Pending entry loading ────────────────────────────────────────────────────

type LoadedEntry = {
  path: string;
  filename: string;
  entry: Entry;
};

function loadPendingEntries(): LoadedEntry[] {
  let filenames: string[];
  try {
    filenames = readdirSync(PENDING_DIR);
  } catch {
    return [];
  }

  const markdownFiles = filenames
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));

  const loaded: LoadedEntry[] = [];
  for (const filename of markdownFiles) {
    const fullPath = join(PENDING_DIR, filename);
    const source = readFileSync(fullPath, "utf8");
    const result = validate(source);
    if (!result.success) {
      throw new Error(
        `Invalid changelog entry ${filename}: [${result.error.code}] ${result.error.message}`,
      );
    }
    loaded.push({ path: fullPath, filename, entry: result.data });
  }
  return loaded;
}

// ─── Version bump ─────────────────────────────────────────────────────────────

type SemVer = { major: number; minor: number; patch: number };

function parseSemVer(version: string): SemVer {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`package.json version is not a plain semver: "${version}"`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function bumpSemVer(current: SemVer, kind: BumpKind): SemVer {
  if (kind === "major") return { major: current.major + 1, minor: 0, patch: 0 };
  if (kind === "minor") return { major: current.major, minor: current.minor + 1, patch: 0 };
  return { major: current.major, minor: current.minor, patch: current.patch + 1 };
}

function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

type PackageJsonWithVersion = { version: string; [key: string]: unknown };

function readPackageJson(): PackageJsonWithVersion {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("version" in parsed)) {
    throw new Error("Root package.json is missing a `version` field.");
  }
  const versionField = (parsed as { version: unknown }).version;
  if (typeof versionField !== "string") {
    throw new Error("Root package.json `version` must be a string.");
  }
  return parsed as PackageJsonWithVersion;
}

function writePackageJsonVersion(nextVersion: string): void {
  const raw = readFileSync(PACKAGE_JSON_PATH, "utf8");
  // Preserve exact formatting (trailing newline, key order, etc.) — only
  // rewrite the version literal on the first `"version": "..."` line.
  const updated = raw.replace(
    /("version"\s*:\s*)"[^"]*"/,
    (_match, prefix: string) => `${prefix}"${nextVersion}"`,
  );
  if (updated === raw) {
    throw new Error("Failed to update package.json — no `version` line matched.");
  }
  writeFileSync(PACKAGE_JSON_PATH, updated);
}

// ─── Notes composition ────────────────────────────────────────────────────────

function today(): string {
  // ISO date-only prefix. Matches draft.ts#todayIsoDate and the sibling
  // scripts/etherfuse-smoke.ts pattern.
  return new Date().toISOString().slice(0, 10);
}

function groupBySection(entries: readonly LoadedEntry[]): Map<SectionKey, LoadedEntry[]> {
  const grouped = new Map<SectionKey, LoadedEntry[]>();
  for (const section of SECTION_ORDER) grouped.set(section, []);
  for (const loaded of entries) {
    const section = CATEGORY_TO_SECTION[loaded.entry.category];
    const bucket = grouped.get(section);
    if (bucket) bucket.push(loaded);
  }
  return grouped;
}

function renderSyncActionsBlock(actions: readonly SyncAction[]): string {
  if (actions.length === 0) return "";
  const lines = actions.map((action) => `- \`${action.kind}\`: ${action.detail}`);
  return [
    "  <details>",
    "  <summary>sync actions</summary>",
    "",
    ...lines.map((line) => `  ${line}`),
    "",
    "  </details>",
  ].join("\n");
}

function renderEntryItem(loaded: LoadedEntry): string {
  const { entry } = loaded;
  const headline = firstMeaningfulLine(entry.body.whatChanged) || loaded.filename;
  const prTag = typeof entry.pr === "number" ? ` (#${entry.pr})` : "";
  const bang = entry.breaking ? "!" : "";
  const bullet = `- ${headline}${bang}${prTag}`;
  const details = renderSyncActionsBlock(entry.sync_actions);
  return details.length > 0 ? `${bullet}\n${details}` : bullet;
}

function firstMeaningfulLine(source: string): string {
  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) continue;
    // Strip leading list markers so we don't double-bullet the item.
    return trimmed.replace(/^-\s+/, "").replace(/^\*\s+/, "");
  }
  return "";
}

function composeNotes(version: string, entries: readonly LoadedEntry[]): string {
  const grouped = groupBySection(entries);
  const lines: string[] = [];
  lines.push(`# v${version} — ${today()}`);
  lines.push("");

  let wroteAnySection = false;
  for (const section of SECTION_ORDER) {
    const bucket = grouped.get(section) ?? [];
    if (bucket.length === 0) continue;
    wroteAnySection = true;
    lines.push(`## ${section}`);
    lines.push("");
    for (const loaded of bucket) {
      lines.push(renderEntryItem(loaded));
    }
    lines.push("");
  }

  if (!wroteAnySection) {
    lines.push("_No changelog entries in this release._");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Shell helpers ────────────────────────────────────────────────────────────

function run(command: string, args: readonly string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", cwd: REPO_ROOT });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

/**
 * Captures stdout of a git subcommand, or `null` on failure. Used only for
 * the pre-flight guards below; the release mutations still go through `run()`
 * so their output streams to the user's terminal.
 */
function capture(command: string, args: readonly string[]): string | null {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return null;
  return typeof result.stdout === "string" ? result.stdout.trim() : null;
}

const RELEASE_BRANCH = "main";

/**
 * Refuses to release from anywhere other than a clean, up-to-date `main`.
 * A previous version tagged and pushed from whatever branch the user was on,
 * publishing a release commit pointing at unreviewed code.
 */
function assertReleaseReadyBranch(): void {
  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== RELEASE_BRANCH) {
    throw new Error(
      `Refusing to release from branch "${branch ?? "<unknown>"}" — switch to "${RELEASE_BRANCH}" first (\`git switch ${RELEASE_BRANCH}\`).`,
    );
  }

  const dirty = capture("git", ["status", "--porcelain"]);
  if (dirty === null) {
    throw new Error("Could not verify working tree is clean (`git status --porcelain` failed).");
  }
  // The release script itself edits changelog/pending/*.md + package.json —
  // require the tree to be clean going in so we don't accidentally include
  // unrelated in-flight work in the release commit.
  const dirtyLines = dirty
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (dirtyLines.length > 0) {
    throw new Error(
      `Refusing to release with a dirty working tree. Commit or stash before releasing:\n${dirtyLines.map((l) => `  ${l}`).join("\n")}`,
    );
  }

  // Fetch (silent) so the up-to-date check compares against the real remote.
  spawnSync("git", ["fetch", "origin", RELEASE_BRANCH], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const local = capture("git", ["rev-parse", `${RELEASE_BRANCH}`]);
  const remote = capture("git", ["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (!local || !remote) {
    throw new Error(
      `Could not resolve local/remote HEADs for ${RELEASE_BRANCH} — is the remote reachable?`,
    );
  }
  if (local !== remote) {
    throw new Error(
      `Local ${RELEASE_BRANCH} (${local.slice(0, 7)}) is out of sync with origin/${RELEASE_BRANCH} (${remote.slice(0, 7)}) — pull or push before releasing.`,
    );
  }
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function logDryRun(message: string): void {
  process.stdout.write(`[dry-run] ${message}\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const parsed = parseCli(process.argv.slice(2));
  if (isCliParseError(parsed)) {
    process.stderr.write(`error: ${parsed.message}\n`);
    process.stderr.write(
      `usage: bun run scripts/changelog/release.ts --bump=<patch|minor|major> [--dry-run]\n`,
    );
    return 1;
  }
  const { bump, dryRun } = parsed;

  const loaded = loadPendingEntries();
  if (loaded.length === 0) {
    process.stderr.write(`error: no entries found in ${PENDING_DIR}. Nothing to release.\n`);
    return 1;
  }
  log(`Validated ${loaded.length} pending changelog ${loaded.length === 1 ? "entry" : "entries"}.`);

  const pkg = readPackageJson();
  const currentVersion = parseSemVer(pkg.version);
  const nextVersion = bumpSemVer(currentVersion, bump);
  const nextVersionString = formatSemVer(nextVersion);
  const tag = `v${nextVersionString}`;
  log(`Bumping ${bump}: ${pkg.version} → ${nextVersionString}`);

  const notes = composeNotes(nextVersionString, loaded);

  if (dryRun) {
    logDryRun(`Would write release notes to ${NOTES_PATH}:`);
    process.stdout.write("---\n");
    process.stdout.write(notes);
    if (!notes.endsWith("\n")) process.stdout.write("\n");
    process.stdout.write("---\n");
    logDryRun(`Would update ${PACKAGE_JSON_PATH} version → "${nextVersionString}"`);
    logDryRun(`Would git rm ${loaded.length} file(s) under changelog/pending/`);
    for (const l of loaded) logDryRun(`  - ${l.filename}`);
    logDryRun(`Would git add package.json`);
    logDryRun(`Would commit as: chore(release): ${tag}`);
    logDryRun(`Would tag ${tag} and push commit + tag`);
    logDryRun(`Would run: gh release create ${tag} --title "${tag}" --notes-file ${NOTES_PATH}`);
    return 0;
  }

  // Pre-flight — no partial releases. Assert we're on a clean, up-to-date
  // `main` before touching any files or shelling out.
  assertReleaseReadyBranch();

  writeFileSync(NOTES_PATH, notes);
  log(`Wrote release notes → ${NOTES_PATH}`);

  writePackageJsonVersion(nextVersionString);
  log(`Updated package.json → ${nextVersionString}`);

  const pendingRelativePaths = loaded.map((l) => `changelog/pending/${l.filename}`);
  run("git", ["rm", ...pendingRelativePaths]);
  run("git", ["add", "package.json"]);
  run("git", ["commit", "-m", `chore(release): ${tag}`]);
  run("git", ["tag", tag]);
  run("git", ["push"]);
  run("git", ["push", "origin", tag]);
  run("gh", ["release", "create", tag, "--title", tag, "--notes-file", NOTES_PATH]);

  log(`Released ${tag}.`);
  return 0;
}

try {
  const code = await main();
  process.exit(code);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}
