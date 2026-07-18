#!/usr/bin/env node
// SessionStart hook — inject a compact summary of unseen pending changelog
// entries into the agent's first turn so Draau (and the agent) know what sync
// actions may be needed since the previous session.
//
// Contract:
//   1. Shell out to `node scripts/changelog/sync-notice.mjs --format=json`.
//   2. Parse JSON. If entries is empty → silent exit 0.
//   3. Otherwise print a compact multi-line context block to stdout
//      (SessionStart injects stdout into the first turn's context).
//   4. Shell out again to `node scripts/changelog/sync-notice.mjs --mark-seen`
//      so subsequent SessionStarts don't repeat the same entries.
//   5. Exit 0.
//
// Matches the JSON-stdin protocol used by other hooks in this dir:
// read stdin (drained even though we don't inspect it for SessionStart),
// silent exit 0 on any parse or subprocess failure so a broken hook can
// never wedge a session.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const STDIN_TIMEOUT_MS = 3000;
const SUBPROCESS_TIMEOUT_MS = 5000;
const SYNC_NOTICE_SCRIPT = path.join('scripts', 'changelog', 'sync-notice.mjs');
const PENDING_DIR = path.join('changelog', 'pending');

// Order MUST match scripts/changelog/types.ts SYNC_ACTION_ORDER — mirrored here
// because this hook is a plain Node script (no bundler, no TS runtime). The
// three-place vocabulary (types.ts / sync-notice.mjs / this file) is a known
// duplication; validate.test.ts asserts the order is aligned across all three.
const SYNC_ACTION_ORDER = {
  env: 0,
  install: 1,
  seed: 2,
  migrate: 3,
  run: 4,
  manual: 5,
};

const SYNC_ACTION_LABEL = {
  env: 'env',
  install: 'install',
  seed: 'seed',
  migrate: 'migrate',
  run: 'run',
  manual: 'manual',
};

function pendingDirHasEntries() {
  try {
    const files = fs.readdirSync(PENDING_DIR);
    return files.some((name) => name.endsWith('.md'));
  } catch {
    return false;
  }
}

function runSyncNotice(args) {
  const result = spawnSync('node', [SYNC_NOTICE_SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: SUBPROCESS_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    // ETIMEDOUT here means sync-notice.mjs hung past SUBPROCESS_TIMEOUT_MS.
    // Emit a stderr breadcrumb so a broken hook is diagnosable — SessionStart
    // hooks otherwise fail-silent forever if the subprocess wedges.
    const errno = typeof result.error.code === 'string' ? result.error.code : '';
    if (errno === 'ETIMEDOUT') {
      process.stderr.write(
        `[changelog-sync-notice] sync-notice.mjs timed out after ${SUBPROCESS_TIMEOUT_MS}ms; banner suppressed.\n`,
      );
    }
    return null;
  }
  if (result.status !== 0) return null;
  return result.stdout;
}

function parseEntries(stdout) {
  if (!stdout) return null;
  try {
    const parsed = JSON.parse(stdout);
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed.entries;
  } catch {
    return null;
  }
}

function formatEntryLine(entry) {
  const date = typeof entry.merged_at === 'string' && entry.merged_at.length > 0
    ? entry.merged_at.slice(0, 10)
    : 'unmerged';
  const category = typeof entry.category === 'string' ? entry.category : 'chore';
  const summary = entry.body && typeof entry.body.whatChanged === 'string'
    ? entry.body.whatChanged.split('\n')[0].trim()
    : '(no summary)';
  return `- ${date} · ${category} · ${summary}`;
}

function groupSyncActions(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const actions = Array.isArray(entry.sync_actions) ? entry.sync_actions : [];
    for (const action of actions) {
      if (!action || typeof action.kind !== 'string') continue;
      const kind = action.kind;
      const detail = typeof action.detail === 'string' ? action.detail : '';
      if (!grouped.has(kind)) grouped.set(kind, new Set());
      grouped.get(kind).add(detail);
    }
  }
  return grouped;
}

function formatSyncActions(grouped) {
  const kinds = Array.from(grouped.keys()).sort((a, b) => {
    const orderA = SYNC_ACTION_ORDER[a] ?? 99;
    const orderB = SYNC_ACTION_ORDER[b] ?? 99;
    return orderA - orderB;
  });
  const lines = [];
  for (const kind of kinds) {
    const label = SYNC_ACTION_LABEL[kind] ?? kind;
    const details = Array.from(grouped.get(kind)).filter(d => d.length > 0).sort();
    if (details.length === 0) {
      lines.push(`- ${label}`);
      continue;
    }
    for (const detail of details) {
      lines.push(`- ${label}: ${detail}`);
    }
  }
  return lines;
}

function buildContext(entries) {
  const entryLines = entries.map(formatEntryLine);
  const grouped = groupSyncActions(entries);
  const actionLines = formatSyncActions(grouped);

  let out = '## Pending changelog entries since last session\n';
  out += entryLines.join('\n') + '\n\n';
  out += '## Sync actions Draau (and you) may need to run\n';
  out += (actionLines.length > 0 ? actionLines.join('\n') : '- (none)') + '\n';
  return out;
}

let input = '';
const stdinTimeout = setTimeout(() => finish(), STDIN_TIMEOUT_MS);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  finish();
});

function finish() {
  try {
    // SessionStart payload isn't inspected — just make sure stdin drains
    // (and stays parseable if a caller sends JSON) before we do work.
    if (input.length > 0) {
      try { JSON.parse(input); } catch { /* non-JSON stdin is fine here */ }
    }

    // Fast path — if there is literally nothing under changelog/pending/,
    // skip the node cold-start for the common case. Saves ~40-80ms per
    // SessionStart in the majority state (no new entries between sessions).
    if (!pendingDirHasEntries()) {
      process.exit(0);
    }

    // Combined flags: sync-notice.mjs handles both in one pass, so we save
    // a second node cold-start + repeat fs walk + repeat YAML parse.
    const stdout = runSyncNotice(['--format=json', '--mark-seen']);
    const entries = parseEntries(stdout);
    if (!entries || entries.length === 0) {
      process.exit(0);
    }

    process.stdout.write(buildContext(entries));
    process.exit(0);
  } catch {
    process.exit(0);
  }
}
