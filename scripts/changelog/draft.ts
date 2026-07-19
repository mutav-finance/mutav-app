/**
 * Draft or overwrite a changelog entry for the current branch.
 *
 * Frontmatter-only. See docs/architecture/changelog.md for the schema.
 *
 *   1. Read current branch + commit subjects + optional PR title.
 *   2. Infer `category` from conventional-commit prefixes (majority vote).
 *   3. Pick `summary`: PR title (prefix-stripped) if a PR exists, otherwise
 *      the most recent commit subject.
 *   4. Call detectSignals() for the mechanical `sync_actions[]` runbook.
 *   5. Write `changelog/pending/YYYY-MM-DD-<slug>.md`, preserving the
 *      existing filename on re-runs so git history stays clean.
 *
 * CLI:
 *   bun run scripts/changelog/draft.ts
 *   bun run scripts/changelog/draft.ts --pr=264
 *   bun run scripts/changelog/draft.ts --base=origin/main --verbose
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectSignals } from "./signals";
import { CATEGORIES, SYNC_ACTION_ORDER, type Category, type Entry, type SyncAction } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BASE_REF = "origin/main";

const REPO_ROOT = resolve(__dirname, "..", "..");

const PENDING_DIR = join(REPO_ROOT, "changelog", "pending");

const BRANCH_PREFIXES: readonly string[] = [
  "feat/",
  "fix/",
  "refactor/",
  "perf/",
  "chore/",
  "docs/",
  "test/",
];

const CATEGORY_TIEBREAK: readonly Category[] = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "chore",
  "docs",
  "test",
];

const CATEGORY_FALLBACK: Category = "chore";

const CONVENTIONAL_COMMIT =
  /^(feat|fix|refactor|perf|chore|docs|test)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;

const SPACE = " ";

// ─── CLI ──────────────────────────────────────────────────────────────────────

type CliArgs = {
  prOverride: number | null;
  baseRef: string;
  verbose: boolean;
};

function parseArgs(argv: readonly string[]): CliArgs {
  let prOverride: number | null = null;
  let baseRef = DEFAULT_BASE_REF;
  let verbose = false;

  for (const arg of argv) {
    if (arg.startsWith("--pr=")) {
      const raw = arg.slice("--pr=".length);
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) prOverride = parsed;
      continue;
    }
    if (arg.startsWith("--base=")) {
      baseRef = arg.slice("--base=".length);
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      verbose = true;
      continue;
    }
  }

  return { prOverride, baseRef, verbose };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const branch = readCurrentBranch();
  if (branch.length === 0) {
    process.stderr.write("Could not determine current branch via `git rev-parse`.\n");
    process.exit(1);
  }
  if (branch === "HEAD") {
    process.stderr.write(
      "Detached HEAD: changelog entries are keyed by branch. Check out a branch " +
        "(e.g. `git switch -c feat/your-feature`) before running `bun run changelog:draft`.\n",
    );
    process.exit(1);
  }

  const slug = slugFromBranch(branch);
  const commits = readCommitSubjects(args.baseRef);
  const prInfo = readPrInfo(args.prOverride);
  const sync_actions = await detectSignals({ baseRef: args.baseRef });

  const entry = buildEntry({ branch, commits, prInfo, sync_actions });

  const filePath = resolveEntryPath(slug, branch);
  const markdown = renderMarkdown(entry);

  ensurePendingDir();
  writeFileSync(filePath, markdown, "utf8");

  process.stdout.write(`${filePath}\n`);
  if (args.verbose) {
    process.stdout.write("\n");
    process.stdout.write(markdown);
    if (!markdown.endsWith("\n")) process.stdout.write("\n");
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`draft.ts failed: ${message}\n`);
    process.exit(1);
  });
}

// ─── Branch + slug ────────────────────────────────────────────────────────────

function readCurrentBranch(): string {
  return runGit(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

function slugFromBranch(branch: string): string {
  let remainder = branch;
  for (const prefix of BRANCH_PREFIXES) {
    if (remainder.startsWith(prefix)) {
      remainder = remainder.slice(prefix.length);
      break;
    }
  }
  return remainder.replace(/\//g, "-");
}

// ─── Git plumbing ─────────────────────────────────────────────────────────────

type ParsedCommit = {
  subject: string;
  category: Category | null;
};

function readCommitSubjects(baseRef: string): ParsedCommit[] {
  // Subjects only — commit bodies are on the PR (`gh pr view` / `git log`).
  // -z (NUL-delimited) is robust to whatever the messages contain.
  const raw = runGit(["log", `${baseRef}..HEAD`, "-z", "--pretty=format:%s"]);
  if (raw.length === 0) return [];

  const subjects = raw
    .split("\0")
    .map((chunk) => chunk.trim())
    .filter((s) => s.length > 0);
  return subjects.map((subject) => ({
    subject,
    category: categoryFromSubject(subject),
  }));
}

/**
 * Returns the conventional-commit `<type>` (feat / fix / …) if the subject
 * matches; otherwise null. The `!` breaking marker is re-detected inside
 * `stripConventionalPrefix` — we don't need to persist it on ParsedCommit.
 */
function categoryFromSubject(subject: string): Category | null {
  const match = subject.match(CONVENTIONAL_COMMIT);
  if (!match) return null;
  const raw = match[1];
  if (!raw) return null;
  return CATEGORIES.includes(raw as Category) ? (raw as Category) : null;
}

// ─── PR info ──────────────────────────────────────────────────────────────────

type PrInfo = {
  number: number;
  title: string;
};

function readPrInfo(prOverride: number | null): PrInfo | null {
  const args = ["pr", "view", "--json", "title,number"];
  if (prOverride !== null) args.push(String(prOverride));

  const raw = runCommand("gh", args);
  if (raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    if (typeof number !== "number") return null;
    return {
      number,
      title: typeof title === "string" ? title : "",
    };
  } catch {
    return null;
  }
}

// ─── Entry construction ───────────────────────────────────────────────────────

type BuildEntryArgs = {
  branch: string;
  commits: ParsedCommit[];
  prInfo: PrInfo | null;
  sync_actions: SyncAction[];
};

function buildEntry(args: BuildEntryArgs): Entry {
  const category = inferCategoryFromParsed(args.commits);
  const summary = deriveSummary(args.commits, args.prInfo);

  return {
    branch: args.branch,
    category,
    summary,
    pr: args.prInfo ? args.prInfo.number : "unmerged",
    sync_actions: sortSyncActions(args.sync_actions),
  };
}

// ─── Category inference (majority vote + tie-break) ───────────────────────────

function inferCategoryFromParsed(commits: readonly ParsedCommit[]): Category {
  if (commits.length === 0) return CATEGORY_FALLBACK;

  const counts = new Map<Category, number>();
  for (const commit of commits) {
    if (!commit.category) continue;
    counts.set(commit.category, (counts.get(commit.category) ?? 0) + 1);
  }

  if (counts.size === 0) return CATEGORY_FALLBACK;

  let winner: Category = CATEGORY_TIEBREAK[0] ?? CATEGORY_FALLBACK;
  let winnerCount = 0;

  for (const category of CATEGORY_TIEBREAK) {
    const count = counts.get(category) ?? 0;
    if (count > winnerCount) {
      winner = category;
      winnerCount = count;
    }
  }

  return winnerCount > 0 ? winner : CATEGORY_FALLBACK;
}

// ─── Summary derivation ──────────────────────────────────────────────────────

/**
 * One-line synthesis. Prefer the PR title (author-written, prefix-stripped).
 * Fall back to the most recent commit subject when no PR is open.
 */
function deriveSummary(commits: readonly ParsedCommit[], prInfo: PrInfo | null): string {
  if (prInfo && prInfo.title.trim().length > 0) {
    return stripConventionalPrefix(prInfo.title);
  }
  const firstNonEmpty = commits.find((c) => c.subject.length > 0);
  if (firstNonEmpty) {
    return stripConventionalPrefix(firstNonEmpty.subject);
  }
  return "TBD — set once the PR is opened or a commit exists.";
}

function stripConventionalPrefix(subject: string): string {
  const match = subject.match(CONVENTIONAL_COMMIT);
  if (!match) return subject;
  const description = match[4] ?? subject;
  const breaking = match[3] === "!";
  return breaking ? `! ${description}` : description;
}

// ─── Sync-actions ordering ────────────────────────────────────────────────────

function sortSyncActions(actions: readonly SyncAction[]): SyncAction[] {
  return [...actions].sort((a, b) => {
    const kindDelta = SYNC_ACTION_ORDER[a.kind] - SYNC_ACTION_ORDER[b.kind];
    if (kindDelta !== 0) return kindDelta;
    return a.detail.localeCompare(b.detail);
  });
}

// ─── Filesystem ───────────────────────────────────────────────────────────────

function ensurePendingDir(): void {
  if (!existsSync(PENDING_DIR)) {
    mkdirSync(PENDING_DIR, { recursive: true });
  }
}

/**
 * Reuse the existing filename (date + slug) if an entry for this branch
 * already exists — keeps re-runs from producing spurious renames in git
 * history. Scans frontmatter for `branch:` first (survives branch renames);
 * falls back to a strict `YYYY-MM-DD-<slug>.md` filename match.
 */
function resolveEntryPath(slug: string, branch: string): string {
  ensurePendingDir();

  const existing = findExistingEntry(slug, branch);
  if (existing) return existing;

  const today = new Date().toISOString().slice(0, 10);
  return join(PENDING_DIR, `${today}-${slug}.md`);
}

function findExistingEntry(slug: string, branch: string): string | null {
  if (!existsSync(PENDING_DIR)) return null;
  const entries = readdirSync(PENDING_DIR).filter((name) => name.endsWith(".md"));

  const branchRe = branchFrontmatterRe(branch);
  const slugRe = slugFilenameRe(slug);

  for (const name of entries) {
    const full = join(PENDING_DIR, name);
    const contents = safeRead(full);
    if (branchRe.test(contents)) return full;
  }

  const slugMatch = entries.find((name) => slugRe.test(name));
  if (slugMatch) return join(PENDING_DIR, slugMatch);

  return null;
}

function branchFrontmatterRe(branch: string): RegExp {
  return new RegExp(`^branch:\\s*${escapeRegex(branch)}\\s*$`, "m");
}

function slugFilenameRe(slug: string): RegExp {
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escapeRegex(slug)}\\.md$`);
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

// ─── Markdown renderer (frontmatter only) ─────────────────────────────────────

function renderMarkdown(entry: Entry): string {
  const lines: string[] = ["---"];
  if (entry.pr !== undefined) {
    lines.push(`pr: ${entry.pr === "unmerged" ? "unmerged" : entry.pr}`);
  }
  lines.push(`branch: ${entry.branch}`);
  if (entry.merged_at) lines.push(`merged_at: ${entry.merged_at}`);
  lines.push(`category: ${entry.category}`);
  lines.push(`summary: ${quoteIfNeeded(entry.summary)}`);
  lines.push(renderSyncActionsBlock(entry.sync_actions));
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

function renderSyncActionsBlock(actions: readonly SyncAction[]): string {
  if (actions.length === 0) return "sync_actions: []";
  const lines: string[] = ["sync_actions:"];
  for (const action of actions) {
    lines.push(`${SPACE}${SPACE}- kind: ${action.kind}`);
    lines.push(`${SPACE}${SPACE}${SPACE}${SPACE}detail: ${quoteDetail(action.detail)}`);
  }
  return lines.join("\n");
}

/**
 * Wrap `summary` in double quotes whenever the YAML subset parser would
 * otherwise coerce it — bare `true`/`false`/`null`, numeric strings, values
 * containing `:` or `#`, or multi-line content. Without this a summary like
 * `"42"` or `"true"` round-trips through `parseScalar` as a number/boolean
 * and Zod validation fails on the mismatch.
 */
function quoteIfNeeded(value: string): string {
  if (value.length === 0) return '""';
  if (value === "true" || value === "false" || value === "null" || value === "~") {
    return quoteDetail(value);
  }
  if (/^-?\d+$/.test(value)) return quoteDetail(value);
  if (value.includes("\n") || value.includes(":") || value.includes("#")) {
    return quoteDetail(value);
  }
  return value;
}

function quoteDetail(detail: string): string {
  const escaped = detail.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// ─── Command runners ──────────────────────────────────────────────────────────

function runGit(args: string[]): string {
  return runCommand("git", args);
}

function runCommand(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

// ─── Public pure-function API (for tests) ─────────────────────────────────────

export function deriveSlug(branch: string): string {
  return slugFromBranch(branch);
}

export function inferCategoryFromSubjects(subjects: readonly string[]): Category {
  const parsed: ParsedCommit[] = subjects.map((subject) => ({
    subject,
    category: categoryFromSubject(subject),
  }));
  return inferCategoryFromParsed(parsed);
}

export function synthesizeSummary(args: {
  commitSubjects: readonly string[];
  prTitle: string | null;
}): string {
  const commits: ParsedCommit[] = args.commitSubjects.map((subject) => ({
    subject,
    category: categoryFromSubject(subject),
  }));
  return deriveSummary(commits, args.prTitle ? { number: 0, title: args.prTitle } : null);
}
