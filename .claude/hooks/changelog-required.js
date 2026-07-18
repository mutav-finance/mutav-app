#!/usr/bin/env node
// PreToolUse hook — require a changelog entry before `gh pr create` / `gh pr edit`.
//
// Contract (see CLAUDE.md § Changelog + docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md):
//   - Every non-trivial PR must ship a `changelog/pending/*.md` entry whose
//     frontmatter `branch:` matches the current branch.
//   - Escape hatch: touch `changelog/pending/.skip-<branch-slug>` to opt out
//     (e.g. docs-only branches the heuristic can't detect).
//   - Trivial diffs (docs, .claude/notes/**) skip the gate — see
//     scripts/changelog/validate.ts#isNonTrivialDiff.

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// `gh pr create` always writes; `gh pr edit --body` (or --body-file) rewrites the
// description. Other `gh pr edit` invocations (labels, reviewers, assignees, title)
// don't need a changelog entry, so we don't want to block them.
const GH_PR_CREATE_RE = /\bgh\s+pr\s+create\b/;
const GH_PR_EDIT_BODY_RE = /\bgh\s+pr\s+edit\b[^\n]*--body(?:-file)?\b/;
const BRANCH_FRONTMATTER_RE = /^branch\s*:\s*(.+?)\s*$/m;
const GIT_SUBPROCESS_TIMEOUT_MS = 3000;

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    if (data.tool_name !== 'Bash') process.exit(0);

    const command = data.tool_input?.command || '';
    if (!GH_PR_CREATE_RE.test(command) && !GH_PR_EDIT_BODY_RE.test(command)) process.exit(0);

    const ctx = getGitContext();
    if (!ctx.repoRoot) process.exit(0);
    if (!ctx.branch || ctx.branch === 'HEAD') process.exit(0);

    const branchSlug = slugifyBranch(ctx.branch);
    const skipMarker = path.join(ctx.repoRoot, 'changelog', 'pending', `.skip-${branchSlug}`);
    if (fs.existsSync(skipMarker)) process.exit(0);

    if (hasEntryForBranch(ctx.repoRoot, ctx.branch)) process.exit(0);

    const requirement = shouldRequireEntry(ctx.repoRoot);
    if (!requirement.required) process.exit(0);

    const baseNote = requirement.baseResolved
      ? ''
      : ' (no merge-base found for origin/main/master; treating as substantive)';
    process.stderr.write(
      `[changelog-required] No changelog entry found for branch ${ctx.branch}${baseNote}.\n` +
        'Run: bun run changelog:draft\n' +
        'See CLAUDE.md § Changelog for the contract.\n'
    );
    process.exit(2);
  } catch {
    process.exit(0);
  }
});

// One subprocess for both repoRoot and branch — `--show-toplevel` prints the
// toplevel, `--abbrev-ref HEAD` prints the branch, in that order on separate
// lines. Saves one fork/exec on the hot path (per `gh pr create`).
function getGitContext() {
  try {
    const out = execSync('git rev-parse --show-toplevel --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_SUBPROCESS_TIMEOUT_MS,
    });
    const lines = out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    return { repoRoot: lines[0] ?? null, branch: lines[1] ?? null };
  } catch {
    return { repoRoot: null, branch: null };
  }
}

/**
 * Encapsulates the "should we block this PR?" contract in one place — the
 * caller sees a bool + a diagnostic flag, not a tuple that has to be recombined
 * with an isNonTrivialDiff check at every callsite. Fail-closed: an unresolved
 * merge-base means we can't prove the diff is trivial, so we treat it as
 * substantive and require the entry.
 */
function shouldRequireEntry(cwd) {
  const base = resolveMergeBase(cwd);
  if (!base) return { required: true, baseResolved: false };

  let diffStat = '';
  try {
    diffStat = execSync(`git diff --name-only ${base}...HEAD`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_SUBPROCESS_TIMEOUT_MS,
    });
  } catch {
    return { required: true, baseResolved: false };
  }

  return { required: isNonTrivialDiff(diffStat), baseResolved: true };
}

function resolveMergeBase(cwd) {
  const candidates = ['origin/main', 'main', 'origin/master', 'master'];
  for (const ref of candidates) {
    try {
      const base = execSync(`git merge-base HEAD ${ref}`, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: GIT_SUBPROCESS_TIMEOUT_MS,
      }).trim();
      if (base.length > 0) return base;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function hasEntryForBranch(repoRoot, branch) {
  const pendingDir = path.join(repoRoot, 'changelog', 'pending');
  if (!fs.existsSync(pendingDir)) return false;

  const files = fs.readdirSync(pendingDir).filter((name) => name.endsWith('.md'));
  for (const name of files) {
    const full = path.join(pendingDir, name);
    let contents = '';
    try {
      contents = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const match = contents.match(BRANCH_FRONTMATTER_RE);
    if (!match) continue;
    const value = stripQuotes(match[1].trim());
    if (value === branch) return true;
  }
  return false;
}

function stripQuotes(raw) {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function slugifyBranch(branch) {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

// Mirrors scripts/changelog/validate.ts#isNonTrivialDiff — kept inline because
// this hook is a plain Node script (no bundler, no TS runtime).
const TRIVIAL_EXTENSIONS = ['.md', '.mdx', '.txt'];
const TRIVIAL_PATH_PREFIXES = ['.claude/notes/'];

function isNonTrivialDiff(diffStat) {
  const paths = diffStat
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (paths.length === 0) return false;

  const substantivePaths = paths.filter((p) => {
    if (TRIVIAL_PATH_PREFIXES.some((prefix) => p.startsWith(prefix))) return false;
    if (TRIVIAL_EXTENSIONS.some((ext) => p.endsWith(ext))) return false;
    return true;
  });

  return substantivePaths.length > 0;
}
