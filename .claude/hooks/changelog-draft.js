#!/usr/bin/env node
// UserPromptSubmit hook — advisory nudge. When the agent is about to open a PR,
// remind it to draft a changelog entry first.
//
// Never blocks. Emits context on stdout so the agent picks it up before
// running the PR command. A separate PreToolUse gate is what actually blocks
// `gh pr create` when no entry exists — this hook just avoids that friction.
//
// See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md.

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PR_TRIGGER = /open (a )?PR|open PR|make (a )?PR|gh pr create|push and open/i;
const PENDING_DIR = 'changelog/pending';
const REMINDER =
  '[changelog-draft] Reminder: no changelog entry for this branch yet. ' +
  'Run `bun run changelog:draft` before `gh pr create` — the PreToolUse gate ' +
  'will block the PR command otherwise.';

const GIT_SUBPROCESS_TIMEOUT_MS = 3000;

function getCurrentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_SUBPROCESS_TIMEOUT_MS,
    }).trim();
  } catch {
    return '';
  }
}

function hasPendingEntryForBranch(branch) {
  if (!branch) return false;
  const dir = path.resolve(process.cwd(), PENDING_DIR);
  let files;
  try {
    files = fs.readdirSync(dir);
  } catch {
    return false;
  }
  const branchLine = new RegExp(`^branch:\\s*['"]?${escapeRegex(branch)}['"]?\\s*$`, 'm');
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    let contents;
    try {
      contents = fs.readFileSync(path.join(dir, file), 'utf8');
    } catch {
      continue;
    }
    if (branchLine.test(contents)) return true;
  }
  return false;
}

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let input = '';
const stdinTimeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(stdinTimeout);
  try {
    const data = JSON.parse(input);
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    if (!PR_TRIGGER.test(prompt)) process.exit(0);

    const branch = getCurrentBranch();
    if (hasPendingEntryForBranch(branch)) process.exit(0);

    process.stdout.write(REMINDER + '\n');
    process.exit(0);
  } catch {
    process.exit(0);
  }
});
