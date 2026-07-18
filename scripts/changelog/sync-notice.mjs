#!/usr/bin/env node
/**
 * Pending sync-actions banner — shared by:
 *   - .husky/post-merge                     (shell users: prints on `git pull`)
 *   - .claude/hooks/changelog-sync-notice.js (SessionStart: injects compact JSON)
 *
 * Kept as plain ES-module JavaScript (no TypeScript) so `node` can run it
 * directly from husky and Claude hooks — no build step, no bun requirement.
 *
 * The peer .ts files (types.ts / validate.ts / signals.ts) are the source of
 * truth for the entry shape. This file re-encodes the tiny YAML subset and
 * vocab constants inline rather than compiling them at runtime — worth the
 * duplication to keep the file zero-dep and instantly runnable. The parser
 * mirrors validate.ts's YAML subset; if that expands, mirror the change here
 * (or promote the parser to a `.mjs` shared module).
 *
 * Modes:
 *   default        Prints banner to stderr, exits 0 (silent if nothing new).
 *   --format=json  Prints { entries, syncActions } to stdout as JSON.
 *   --mark-seen    Updates `.claude/notes/.changelog-seen` to now.
 *
 * Flags may be combined (e.g. the SessionStart hook does `--format=json --mark-seen`).
 *
 * See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md.
 */

import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Paths ────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const PENDING_DIR = join(REPO_ROOT, "changelog", "pending");
const SEEN_PATH = join(REPO_ROOT, ".claude", "notes", ".changelog-seen");

// ─── Vocabulary (mirrors scripts/changelog/types.ts) ──────────────────────────

const SYNC_ACTION_KINDS = ["env", "install", "seed", "migrate", "run", "manual"];
const CATEGORIES = ["feat", "fix", "refactor", "perf", "chore", "docs", "test"];
const SYNC_ACTION_ORDER = {
  env: 0,
  install: 1,
  seed: 2,
  migrate: 3,
  run: 4,
  manual: 5,
};

// ─── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const flags = { format: "banner", markSeen: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--mark-seen") flags.markSeen = true;
    else if (arg === "--format=json") flags.format = "json";
    else if (arg === "--format=banner") flags.format = "banner";
    else if (arg.startsWith("--format=")) flags.format = arg.slice("--format=".length);
  }
  return flags;
}

// ─── Frontmatter parser (YAML subset, mirrors validate.ts) ────────────────────

const FRONTMATTER_FENCE = "---";

function splitFrontmatter(source) {
  // Mirror validate.ts: strip BOM + normalize CRLF/CR → LF so the same file
  // parses identically whether it's Unix or Windows authored.
  const normalized = source.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith(FRONTMATTER_FENCE)) return null;
  const afterOpening = normalized.slice(FRONTMATTER_FENCE.length);
  const closingIndex = afterOpening.indexOf(`\n${FRONTMATTER_FENCE}`);
  if (closingIndex === -1) return null;
  const raw = afterOpening.slice(0, closingIndex).replace(/^\n/, "");
  return { raw };
}

function parseScalar(raw) {
  if (raw.length === 0) return "";
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseScalarOrInlineList(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  return parseScalar(trimmed);
}

function parseYamlSubset(raw) {
  const lines = raw.split("\n");
  const root = {};
  let currentListKey = null;
  let currentList = null;
  let currentListItem = null;

  const flushListItem = () => {
    if (currentListItem && currentList) currentList.push(currentListItem);
    currentListItem = null;
  };
  const flushList = () => {
    flushListItem();
    if (currentListKey && currentList) root[currentListKey] = currentList;
    currentListKey = null;
    currentList = null;
  };

  for (const line of lines) {
    if (line === undefined) continue;
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;

    const topLevelMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (topLevelMatch && !line.startsWith(" ") && !line.startsWith("\t")) {
      flushList();
      const key = topLevelMatch[1] ?? "";
      const rest = (topLevelMatch[2] ?? "").trim();
      if (rest.length === 0) {
        currentListKey = key;
        currentList = [];
        continue;
      }
      root[key] = parseScalarOrInlineList(rest);
      continue;
    }

    const listItemMatch = line.match(/^\s*-\s+(.*)$/);
    if (listItemMatch && currentList) {
      const rest = listItemMatch[1] ?? "";
      const mapMatch = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (mapMatch) {
        flushListItem();
        currentListItem = {};
        const k = mapMatch[1] ?? "";
        const v = (mapMatch[2] ?? "").trim();
        if (v.length > 0) currentListItem[k] = parseScalarOrInlineList(v);
        continue;
      }
      flushListItem();
      currentList.push(parseScalarOrInlineList(rest));
      continue;
    }

    const continuationMatch = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (continuationMatch && currentListItem) {
      const k = continuationMatch[1] ?? "";
      const v = (continuationMatch[2] ?? "").trim();
      currentListItem[k] = parseScalarOrInlineList(v);
      continue;
    }

    return null;
  }

  flushList();
  return root;
}

// ─── Entry loading ────────────────────────────────────────────────────────────

function safeListPending() {
  if (!existsSync(PENDING_DIR)) return [];
  try {
    return readdirSync(PENDING_DIR)
      .filter((name) => name.endsWith(".md") && !name.startsWith(".skip-"))
      .map((name) => join(PENDING_DIR, name));
  } catch {
    return [];
  }
}

function normalizeSyncAction(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind;
  const detail = typeof raw.detail === "string" ? raw.detail : "";
  if (!SYNC_ACTION_KINDS.includes(kind)) return null;
  if (detail.length === 0) return null;
  return { kind, detail };
}

function normalizeStringArray(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => typeof item === "string" && item.length > 0);
}

function loadEntry(filePath) {
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const split = splitFrontmatter(source);
  if (!split) return null;
  const frontmatter = parseYamlSubset(split.raw);
  if (!frontmatter) return null;

  const rawSyncActions = Array.isArray(frontmatter.sync_actions) ? frontmatter.sync_actions : [];
  const syncActions = rawSyncActions
    .map((raw) => normalizeSyncAction(raw))
    .filter((action) => action !== null)
    .sort((a, b) => {
      const kindDelta = SYNC_ACTION_ORDER[a.kind] - SYNC_ACTION_ORDER[b.kind];
      if (kindDelta !== 0) return kindDelta;
      return a.detail.localeCompare(b.detail);
    });

  const merged_at = typeof frontmatter.merged_at === "string" ? frontmatter.merged_at : undefined;
  const branch = typeof frontmatter.branch === "string" ? frontmatter.branch : "";
  const category = CATEGORIES.includes(frontmatter.category) ? frontmatter.category : "chore";
  const pr =
    typeof frontmatter.pr === "number" || frontmatter.pr === "unmerged"
      ? frontmatter.pr
      : "unmerged";

  // Parse the effective timestamp once here. Downstream filter + sort read the
  // numeric ms directly — no repeated `Date.parse()` per comparison, and a
  // malformed `merged_at` producing `NaN` fails loudly at this one point
  // rather than silently disappearing from filter output on every callsite.
  const mtimeMs = readMtimeMs(filePath);
  const effectiveMs = merged_at ? Date.parse(merged_at) : mtimeMs;

  return {
    filePath,
    pr,
    branch,
    category,
    merged_at,
    scopes: normalizeStringArray(frontmatter.scopes),
    touched_domains: normalizeStringArray(frontmatter.touched_domains),
    issue_refs: normalizeStringArray(frontmatter.issue_refs),
    sync_actions: syncActions,
    effectiveMs: Number.isFinite(effectiveMs) ? effectiveMs : mtimeMs,
    effectiveIso: merged_at ?? new Date(mtimeMs).toISOString(),
  };
}

function readMtimeMs(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

// ─── Seen-marker I/O ──────────────────────────────────────────────────────────

function readSeenIso() {
  if (!existsSync(SEEN_PATH)) return null;
  try {
    const contents = readFileSync(SEEN_PATH, "utf8");
    const parsed = JSON.parse(contents);
    if (parsed && typeof parsed.seenIso === "string") return parsed.seenIso;
    return null;
  } catch {
    return null;
  }
}

function writeSeenIso(iso) {
  const dir = dirname(SEEN_PATH);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SEEN_PATH, JSON.stringify({ seenIso: iso }, null, 2) + "\n", "utf8");
  } catch {
    // Silent — the banner is advisory; a read-only fs shouldn't fail the pull.
  }
}

// ─── Banner rendering ─────────────────────────────────────────────────────────

const KIND_LABEL_WIDTH = "install".length; // longest label — pads the column.

function padKindLabel(kind) {
  return kind + " ".repeat(Math.max(0, KIND_LABEL_WIDTH - kind.length));
}

function renderBanner(entries, syncActions) {
  const count = entries.length;
  const noun = count === 1 ? "entry" : "entries";
  const header = `📋 ${count} changelog ${noun} since your last pull:`;
  const rows = syncActions.map((action) => `  ▸ ${padKindLabel(action.kind)}  ${action.detail}`);
  const footer = "Full entries: changelog/pending/*.md";
  return [header, ...rows, footer].join("\n") + "\n";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const flags = parseArgs(process.argv);
  const seenIso = readSeenIso();
  const nowIso = new Date().toISOString();
  const seenMs = seenIso ? Date.parse(seenIso) : null;

  // Stat-first: skip the readFileSync + YAML parse for any entry the caller
  // has already acknowledged. When seenMs is null (first run), everyone
  // passes through. This dominates the common case where pending accumulates
  // between releases but only 1-2 entries are new since last SessionStart.
  const candidatePaths = safeListPending().filter((filePath) => {
    if (seenMs === null) return true;
    try {
      return statSync(filePath).mtimeMs > seenMs;
    } catch {
      return true;
    }
  });

  const entries = candidatePaths
    .map((filePath) => loadEntry(filePath))
    .filter((entry) => entry !== null)
    // Compare via numeric ms computed once in loadEntry() — date-only
    // `merged_at` ("2026-07-18") vs full ISO `seenMs` no longer confuses
    // lex-string comparison, and each entry's timestamp is parsed once.
    .filter((entry) => (seenMs !== null ? entry.effectiveMs > seenMs : true))
    .sort((a, b) => a.effectiveMs - b.effectiveMs);

  const syncActions = entries.flatMap((entry) => entry.sync_actions);

  if (flags.format === "json") {
    const payload = {
      entries: entries.map(({ filePath, effectiveIso, ...rest }) => ({
        ...rest,
        file: filePath,
      })),
      syncActions,
    };
    process.stdout.write(JSON.stringify(payload) + "\n");
  } else if (entries.length > 0) {
    process.stderr.write(renderBanner(entries, syncActions));
  }

  if (flags.markSeen) writeSeenIso(nowIso);
  process.exit(0);
}

main();
