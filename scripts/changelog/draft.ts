/**
 * Draft or overwrite a changelog entry for the current branch.
 *
 * See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md
 * (§ Author workflow) for the full behavior. High-level:
 *
 *   1. Read the current branch, diff vs base, and conventional-commit log.
 *   2. Optionally read PR title/body/number via `gh pr view --json …`.
 *   3. Call detectSignals() for the mechanical sync_actions runbook.
 *   4. Infer category / scopes / touched_domains / breaking / issue_refs
 *      from that raw material — never invent facts.
 *   5. Write `changelog/pending/YYYY-MM-DD-<slug>.md`, preserving the
 *      original filename (date + slug) if an entry for the branch already
 *      exists so git history stays clean.
 *
 * CLI:
 *
 *   bun run scripts/changelog/draft.ts
 *   bun run scripts/changelog/draft.ts --pr=264
 *   bun run scripts/changelog/draft.ts --base=origin/main --verbose
 *
 * Prints the resulting file path to stdout. `--verbose` also prints the file.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { detectSignals } from "./signals";
import {
  CATEGORIES,
  SYNC_ACTION_ORDER,
  type Category,
  type Entry,
  type EntryBody,
  type SyncAction,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BASE_REF = "origin/main";

const REPO_ROOT = resolve(__dirname, "..", "..");

const PENDING_DIR = join(REPO_ROOT, "changelog", "pending");

/**
 * Branch-prefix stripping order matters — we strip the first match, so listing
 * the closed conventional-commit vocabulary here keeps the slug stable.
 */
const BRANCH_PREFIXES: readonly string[] = [
  "feat/",
  "fix/",
  "refactor/",
  "perf/",
  "chore/",
  "docs/",
  "test/",
];

/**
 * Category priority for tie-breaking when the commit log's conventional-commit
 * prefixes split evenly. Ordered high → low precedence:
 * feat > fix > refactor > perf > chore > docs > test.
 */
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

const BREAKING_MARKER = /BREAKING CHANGE/;

const ISSUE_REF_PATTERN = /(?:^|[\s(])((?:[a-z][a-z0-9-]+#|#)\d+)/gi;

/**
 * Git trailers to strip from commit bodies before they land in the
 * `## Notes for future agents` section — they're captured by git's own
 * author metadata and add pure noise to agent context.
 */
const GIT_TRAILER_PATTERN =
  /^(?:Co-authored-by|Signed-off-by|Reviewed-by|Reported-by|Suggested-by|Acked-by|Tested-by|Cc):\s/i;

const SPACE = " ";

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

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
      "Detached HEAD: changelog entries are keyed by branch, so `git rev-parse --abbrev-ref HEAD` returning `HEAD` is not a valid target.\n" +
        "Check out a branch first (e.g. `git switch -c feat/your-feature`) before running `bun run changelog:draft`.\n",
    );
    process.exit(1);
  }

  const slug = slugFromBranch(branch);
  const commits = readCommitMessages(args.baseRef);
  const changedPaths = readChangedPaths(args.baseRef);
  const prInfo = readPrInfo(args.prOverride);
  const sync_actions = await detectSignals({ baseRef: args.baseRef });

  const entry = buildEntry({
    branch,
    commits,
    changedPaths,
    prInfo,
    sync_actions,
  });

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

// Bun sets `import.meta.main` when this file is the entrypoint — matches the
// pattern already used in validate.ts. Falling back to argv[1] filename
// matching (as an earlier version did) breaks on symlinks and renames.
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
  body: string;
  category: Category | null;
  scope: string | null;
  breakingBang: boolean;
  breakingFooter: boolean;
};

function readCommitMessages(baseRef: string): ParsedCommit[] {
  // `-z` uses NUL as the between-commit separator (not the sentinel string
  // approach). Robust to commit messages that literally contain any string
  // sentinel we could otherwise pick.
  const raw = runGit(["log", `${baseRef}..HEAD`, "-z", "--pretty=format:%s%n%b"]);
  if (raw.length === 0) return [];

  const chunks = raw.split("\0").map((chunk) => chunk.trim());
  const commits: ParsedCommit[] = [];

  for (const chunk of chunks) {
    if (chunk.length === 0) continue;
    const lines = chunk.split("\n");
    const subject = lines[0] ?? "";
    const body = lines.slice(1).join("\n").trim();
    const parsed = parseConventionalCommit(subject);

    commits.push({
      subject,
      body,
      category: parsed.category,
      scope: parsed.scope,
      breakingBang: parsed.breakingBang,
      breakingFooter: BREAKING_MARKER.test(body) || BREAKING_MARKER.test(subject),
    });
  }

  return commits;
}

function parseConventionalCommit(subject: string): {
  category: Category | null;
  scope: string | null;
  breakingBang: boolean;
} {
  const match = subject.match(CONVENTIONAL_COMMIT);
  if (!match) return { category: null, scope: null, breakingBang: false };
  const raw = match[1];
  if (!raw) return { category: null, scope: null, breakingBang: false };
  const category = CATEGORIES.includes(raw as Category) ? (raw as Category) : null;
  return {
    category,
    scope: match[2] ?? null,
    breakingBang: match[3] === "!",
  };
}

function readChangedPaths(baseRef: string): string[] {
  const raw = runGit(["diff", "--name-only", `${baseRef}...HEAD`]);
  const committed = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (committed.length > 0) return committed;
  return readWorkingTreePaths();
}

function readWorkingTreePaths(): string[] {
  const tracked = runGit(["diff", "--name-only", "HEAD"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const untracked = runGit(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return [...new Set([...tracked, ...untracked])];
}

// ─── PR info ──────────────────────────────────────────────────────────────────

type PrInfo = {
  number: number;
  title: string;
  body: string;
  url: string;
};

function readPrInfo(prOverride: number | null): PrInfo | null {
  const args = ["pr", "view", "--json", "title,body,number,url"];
  if (prOverride !== null) args.push(String(prOverride));

  const raw = runCommand("gh", args);
  if (raw.length === 0) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const number = record.number;
    const title = record.title;
    const body = record.body;
    const url = record.url;
    if (typeof number !== "number") return null;
    return {
      number,
      title: typeof title === "string" ? title : "",
      body: typeof body === "string" ? body : "",
      url: typeof url === "string" ? url : "",
    };
  } catch {
    return null;
  }
}

// ─── Entry construction ───────────────────────────────────────────────────────

type BuildEntryArgs = {
  branch: string;
  commits: ParsedCommit[];
  changedPaths: string[];
  prInfo: PrInfo | null;
  sync_actions: SyncAction[];
};

function buildEntry(args: BuildEntryArgs): Entry {
  const category = inferCategoryFromParsed(args.commits);
  const scopes = inferScopes(args.commits);
  const touched_domains = inferTouchedDomains(args.changedPaths);
  const issue_refs = inferIssueRefs(args.commits, args.prInfo);
  const breaking = args.commits.some((c) => c.breakingBang || c.breakingFooter);
  const body = buildBody(args.commits, args.prInfo);

  return {
    pr: args.prInfo ? args.prInfo.number : "unmerged",
    branch: args.branch,
    category,
    scopes,
    breaking,
    sync_actions: sortSyncActions(args.sync_actions),
    touched_domains,
    issue_refs,
    body,
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
  let winnerCount = -1;

  for (const category of CATEGORY_TIEBREAK) {
    const count = counts.get(category) ?? 0;
    if (count > winnerCount) {
      winner = category;
      winnerCount = count;
    }
  }

  return winnerCount > 0 ? winner : CATEGORY_FALLBACK;
}

// ─── Scopes (from conventional-commit prefixes) ───────────────────────────────

function inferScopes(commits: readonly ParsedCommit[]): string[] {
  const scopes = new Set<string>();
  for (const commit of commits) {
    if (commit.scope && commit.scope.length > 0) scopes.add(commit.scope);
  }
  return [...scopes].sort();
}

// ─── Touched domains (from changed file paths) ────────────────────────────────

/**
 * Map a changed path to its coarse domain — the string a consuming agent would
 * grep for when filtering entries by their current work area:
 *
 *   convex/contracts/useCases.ts → convex/contracts
 *   packages/ui/src/button.tsx   → packages/ui
 *   apps/agency/src/…            → apps/agency
 *   docs/architecture/…          → docs
 *   scripts/foo.ts               → scripts
 *   .claude/hooks/foo.js         → .claude
 *   README.md                    → root
 */
function domainForPath(path: string): string | null {
  if (path.startsWith("convex/")) {
    const rest = path.slice("convex/".length);
    const segments = rest.split("/");
    const first = segments[0];
    if (!first) return "convex";
    // Files directly under convex/ (schema.ts, seed.ts, crons.ts, http.ts) get a
    // single `convex` bucket; nested folders (convex/<domain>/…) keep the domain.
    if (segments.length === 1) return "convex";
    return `convex/${first}`;
  }
  if (path.startsWith("packages/")) {
    const first = path.slice("packages/".length).split("/")[0];
    return first ? `packages/${first}` : null;
  }
  if (path.startsWith("apps/")) {
    const first = path.slice("apps/".length).split("/")[0];
    return first ? `apps/${first}` : null;
  }
  if (path.startsWith("docs/")) return "docs";
  if (path.startsWith("scripts/")) return "scripts";
  if (path.startsWith(".claude/")) return ".claude";
  if (path.startsWith(".husky/")) return ".husky";
  if (path.startsWith(".github/")) return ".github";
  if (path.includes("/")) return null;
  return "root";
}

function inferTouchedDomains(paths: readonly string[]): string[] {
  const domains = new Set<string>();
  for (const path of paths) {
    const domain = domainForPath(path);
    if (domain) domains.add(domain);
  }
  return [...domains].sort();
}

// ─── Issue refs (from commit trailers + PR body) ──────────────────────────────

function inferIssueRefs(commits: readonly ParsedCommit[], prInfo: PrInfo | null): string[] {
  const refs = new Set<string>();
  const collect = (text: string) => {
    for (const match of text.matchAll(ISSUE_REF_PATTERN)) {
      const ref = match[1];
      if (ref) refs.add(ref);
    }
  };

  for (const commit of commits) {
    collect(commit.subject);
    if (commit.body.length > 0) collect(commit.body);
  }
  if (prInfo) collect(prInfo.body);

  return [...refs].sort();
}

// ─── Body sections ────────────────────────────────────────────────────────────

/**
 * Compose the `## What changed` and `## Notes for future agents` sections from
 * commit messages and (if present) the PR body. Deliberately mechanical — the
 * drafter never invents rationale; if the raw material is thin, the entry is
 * thin, and a human/agent will flesh it out on the next pass.
 */
function buildBody(commits: readonly ParsedCommit[], prInfo: PrInfo | null): EntryBody {
  const whatChanged = buildWhatChanged(commits, prInfo);
  const notesForAgents = buildNotesForAgents(commits, prInfo);
  return { whatChanged, notesForAgents };
}

/**
 * Single-line synthesis. Prefer the PR title (author-written) — a good PR
 * title already is the one-line summary. Fall back to the most recent commit
 * subject as a pre-PR draft, then to a TBD prompt if neither exists.
 *
 * No commit-bullet log here — those are accessible via `gh pr view` /
 * `git log`, and duplicating them turns the entry into a scrolling log.
 */
function buildWhatChanged(commits: readonly ParsedCommit[], prInfo: PrInfo | null): string {
  if (prInfo && prInfo.title.trim().length > 0) {
    return stripConventionalPrefix(prInfo.title);
  }
  const firstNonEmpty = commits.find((c) => c.subject.length > 0);
  if (firstNonEmpty) {
    return stripConventionalPrefix(firstNonEmpty.subject);
  }
  return "TBD — set once the PR is opened or a commit exists.";
}

/**
 * Notes are FORWARD-GUIDANCE, not a log. Extract a purpose-built section
 * from the PR body if one exists (author wrote it once, focused on the WHY
 * and non-obvious constraints). Commit bodies are NEVER pooled here — the
 * commits are already on the PR, so re-embedding just duplicates a story
 * `gh pr view` gives cheap access to.
 *
 * If no matching section is found, emit a strong TBD prompt telling the
 * next author exactly what to write and where to put it.
 */
function buildNotesForAgents(_commits: readonly ParsedCommit[], prInfo: PrInfo | null): string {
  if (prInfo) {
    const extracted = extractNotesSection(prInfo.body);
    if (extracted) return stripTrailers(extracted);
  }
  return (
    "TBD — the next agent needs the WHY: non-obvious constraints, hidden invariants, " +
    "and decisions the diff can't reveal. Add a `## Notes for future agents` " +
    "section to the PR body (or `## Rationale` / `## Why`) — the drafter will " +
    "pull it in automatically on the next `bun run changelog:draft`."
  );
}

/**
 * Case-insensitive scan for a Notes-shaped section heading in the PR body.
 * Returns the section content (bounded by the next `## ` heading or EOF),
 * or null if no matching heading is found. `escapeRegex` neutralizes any
 * regex metachars in the heading list.
 */
const NOTES_SECTION_HEADINGS: readonly string[] = [
  "Notes for future agents",
  "Notes",
  "Rationale",
  "Why this shape",
  "Why",
];

function extractNotesSection(prBody: string): string | null {
  if (!prBody || prBody.trim().length === 0) return null;
  for (const heading of NOTES_SECTION_HEADINGS) {
    const headingRe = new RegExp(`^##\\s+${escapeRegex(heading)}\\s*$`, "im");
    const match = headingRe.exec(prBody);
    if (!match) continue;
    const startIdx = match.index + match[0].length;
    const after = prBody.slice(startIdx);
    const nextHeading = /^##\s+/m.exec(after);
    const section = nextHeading ? after.slice(0, nextHeading.index) : after;
    const cleaned = section.trim();
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

/**
 * Strip the `<type>(<scope>):` prefix — the type is already in `category:` and
 * the scope in `scopes:`, so restating them in the bullet is noise.
 * Preserves the `!` breaking marker if present (as a caret prefix) so the
 * bullet still signals breakage without the conventional-commit machinery.
 */
function stripConventionalPrefix(subject: string): string {
  const match = subject.match(CONVENTIONAL_COMMIT);
  if (!match) return subject;
  const description = match[4] ?? subject;
  const breaking = match[3] === "!";
  return breaking ? `! ${description}` : description;
}

/**
 * Drop git trailer lines (Co-authored-by, Signed-off-by, etc.) from a commit
 * body — they're captured in git's author metadata already and add nothing
 * to agent context. Also collapses runs of blank lines left behind.
 */
function stripTrailers(body: string): string {
  return body
    .split("\n")
    .filter((line) => !GIT_TRAILER_PATTERN.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Sync actions ordering ────────────────────────────────────────────────────

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
 * Preserve the existing filename (date prefix + slug) when an entry for this
 * branch already exists — keeps re-runs from producing spurious renames in
 * git history. Otherwise use today's ISO date.
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

  // Scan frontmatter for `branch: <branch>` FIRST. This survives branch renames
  // (the entry still points at the new branch name after `bun run changelog:draft`
  // rewrites it) and prevents the substring bug where slug `wizard` matched an
  // entry named `2026-07-01-agency-wizard.md`.
  for (const name of entries) {
    const full = join(PENDING_DIR, name);
    const contents = safeRead(full);
    if (branchRe.test(contents)) return full;
  }

  // Fall back to a strict filename match: `YYYY-MM-DD-<slug>.md`. Anchored so
  // `wizard` cannot match `agency-wizard.md`.
  const slugMatch = entries.find((name) => slugRe.test(name));
  if (slugMatch) return join(PENDING_DIR, slugMatch);

  return null;
}

/** Anchored `^branch: <branch>` — drafter emits the value unquoted, no strip. */
function branchFrontmatterRe(branch: string): RegExp {
  return new RegExp(`^branch:\\s*${escapeRegex(branch)}\\s*$`, "m");
}

/** Strict `YYYY-MM-DD-<slug>.md` filename match. Anchored to avoid substrings. */
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

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(entry: Entry): string {
  const lines: string[] = [];
  lines.push("---");
  lines.push(`pr: ${entry.pr === "unmerged" ? "unmerged" : entry.pr}`);
  lines.push(`branch: ${entry.branch}`);
  if (entry.merged_at) lines.push(`merged_at: ${entry.merged_at}`);
  lines.push(`category: ${entry.category}`);
  // Empty arrays are omitted — the validator defaults them to [] on parse.
  // Keeps the frontmatter tight when a change is small-scope.
  if (entry.scopes.length > 0) lines.push(`scopes: ${renderInlineList(entry.scopes)}`);
  if (entry.breaking) lines.push(`breaking: true`);
  lines.push(renderSyncActionsBlock(entry.sync_actions));
  if (entry.touched_domains.length > 0)
    lines.push(renderBlockList("touched_domains", entry.touched_domains));
  if (entry.issue_refs.length > 0) lines.push(`issue_refs: ${renderInlineList(entry.issue_refs)}`);
  lines.push("---");
  lines.push("");
  lines.push("## What changed");
  lines.push(entry.body.whatChanged);
  lines.push("");
  lines.push("## Notes for future agents");
  lines.push(entry.body.notesForAgents);
  lines.push("");
  return lines.join("\n");
}

function renderInlineList(items: readonly string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.join(", ")}]`;
}

function renderBlockList(key: string, items: readonly string[]): string {
  if (items.length === 0) return `${key}: []`;
  const lines: string[] = [`${key}:`];
  for (const item of items) {
    lines.push(`${SPACE}${SPACE}- ${item}`);
  }
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

function quoteDetail(detail: string): string {
  // Wrap in double quotes and escape embedded quotes/backslashes — keeps
  // parseYamlSubset in validate.ts happy (`"…"` becomes an unquoted scalar).
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

// ─── Public pure-function API (for tests + external callers) ──────────────────
//
// These wrappers expose the internal helpers under stable names taking plain
// inputs (branch strings, commit subject lists, path lists). The CLI keeps
// using the richer ParsedCommit-driven internals; tests exercise the pure
// projection here without stubbing git.

export function deriveSlug(branch: string): string {
  return slugFromBranch(branch);
}

export function inferCategory(subjects: readonly string[]): Category {
  const parsed: ParsedCommit[] = subjects.map((subject) => {
    const shape = parseConventionalCommit(subject);
    return {
      subject,
      body: "",
      category: shape.category,
      scope: shape.scope,
      breakingBang: shape.breakingBang,
      breakingFooter: false,
    };
  });
  return inferCategoryFromParsed(parsed);
}

export function extractScopes(paths: readonly string[]): string[] {
  return inferTouchedDomains(paths);
}

export type ComposeBodyCommit = { subject: string; body: string };
export type ComposeBodyPrInfo = { number: number; title: string; body: string; url: string };
export type ComposeBodyArgs = {
  commits: readonly ComposeBodyCommit[];
  prInfo: ComposeBodyPrInfo | null;
};

export function composeBody(args: ComposeBodyArgs): EntryBody {
  const parsed: ParsedCommit[] = args.commits.map((c) => {
    const shape = parseConventionalCommit(c.subject);
    return {
      subject: c.subject,
      body: c.body,
      category: shape.category,
      scope: shape.scope,
      breakingBang: shape.breakingBang,
      breakingFooter: BREAKING_MARKER.test(c.body),
    };
  });
  return buildBody(parsed, args.prInfo);
}
