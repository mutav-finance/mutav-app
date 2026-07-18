/**
 * Schema validation for `changelog/pending/*.md` entries.
 *
 * Shared by:
 *   - .husky/pre-push  → `bun run changelog:validate` (primary gate; fires
 *     for non-Claude workflows too, e.g. Draau's shell).
 *   - .claude/hooks/changelog-required.js → PreToolUse gate on `gh pr create`.
 *
 * See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md.
 *
 * Parsing:
 *   - Accepts a raw markdown string with YAML frontmatter (`---` fences), or
 *     a partially-typed object (already-parsed frontmatter merged with a body).
 *   - Frontmatter parser is a small, purpose-built YAML subset — the harness
 *     controls the shape of the file (it's agent-authored), so we avoid
 *     pulling in gray-matter / js-yaml as a new runtime dep.
 *
 * Non-trivial-diff heuristic (`isNonTrivialDiff`) mirrors the tone of
 * .claude/hooks/code-quality.js: docs-only, whitespace-only, and
 * .claude/notes/** changes are skipped so the sensor never blocks a no-op PR.
 */

import { z } from "zod";
import {
  CATEGORIES,
  SYNC_ACTION_KINDS,
  SYNC_ACTION_ORDER,
  type Category,
  type Entry,
  type EntryBody,
  type Result,
  type SyncAction,
  type SyncActionKind,
  type ValidationError,
} from "./types";

// ─── Non-trivial-diff heuristic ───────────────────────────────────────────────

const TRIVIAL_EXTENSIONS = [".md", ".mdx", ".txt"];
const TRIVIAL_PATH_PREFIXES = [".claude/notes/"];

/**
 * Returns true when the diff has at least one substantive change — used by
 * hooks + husky to decide whether to enforce the "PR must have a changelog
 * entry" rule. Trivial cases skipped:
 *
 *   - Empty diff (no files changed)
 *   - Docs-only changes (only .md / .mdx / .txt files)
 *   - Notes-only changes (all paths under .claude/notes/**)
 *
 * `diffStat` is the output of `git diff --name-only <base>...HEAD` — one path
 * per line. Whitespace-only detection is not attempted here; a caller that
 * needs it should re-run `git diff --shortstat` and compare insertions.
 */
export function isNonTrivialDiff(diffStat: string): boolean {
  const paths = diffStat
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (paths.length === 0) return false;

  const substantivePaths = paths.filter((path) => {
    if (TRIVIAL_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
    if (TRIVIAL_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
    return true;
  });

  return substantivePaths.length > 0;
}

// ─── Frontmatter parsing (minimal YAML subset) ────────────────────────────────

const FRONTMATTER_FENCE = "---";

type ParsedMarkdown = {
  frontmatter: Record<string, unknown>;
  body: string;
};

/**
 * Splits a markdown string into the raw frontmatter block and the body.
 * Returns null when the file doesn't start with a `---` fence.
 */
function splitFrontmatter(source: string): { raw: string; body: string } | null {
  // Strip UTF-8 BOM, then normalize CRLF → LF so a Windows-authored entry
  // parses the same as a Unix-authored one. Without this, the line-oriented
  // parser sees trailing `\r` on every value and the regex matchers fail.
  const normalized = source.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith(FRONTMATTER_FENCE)) return null;

  const afterOpening = normalized.slice(FRONTMATTER_FENCE.length);
  const closingIndex = afterOpening.indexOf(`\n${FRONTMATTER_FENCE}`);
  if (closingIndex === -1) return null;

  const raw = afterOpening.slice(0, closingIndex).replace(/^\n/, "");
  const body = afterOpening.slice(closingIndex + FRONTMATTER_FENCE.length + 1);
  return { raw, body: body.replace(/^\n/, "") };
}

/**
 * Purpose-built parser for the YAML subset the drafter emits:
 *   - `key: value` scalars (strings, numbers, booleans)
 *   - `key: [a, b, c]` inline lists of scalars
 *   - block lists via `- ` prefix
 *   - block maps two levels deep (top-level → `- key: value` entries)
 *
 * Not a general YAML parser. If the file uses anything outside this subset,
 * validate() surfaces an INVALID_FRONTMATTER error instead of silently
 * misparsing.
 */
function parseYamlSubset(raw: string): Record<string, unknown> | null {
  const lines = raw.split("\n");
  const root: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  let currentList: unknown[] | null = null;
  let currentListItem: Record<string, unknown> | null = null;

  const flushListItem = () => {
    if (currentListItem && currentList) {
      currentList.push(currentListItem);
    }
    currentListItem = null;
  };

  const flushList = () => {
    flushListItem();
    if (currentListKey && currentList) {
      root[currentListKey] = currentList;
    }
    currentListKey = null;
    currentList = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (line.trim().length === 0) continue;
    if (line.trim().startsWith("#")) continue;

    // Top-level key.
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

    // List item (either scalar or start of a map item).
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
      // Scalar list item.
      flushListItem();
      currentList.push(parseScalarOrInlineList(rest));
      continue;
    }

    // Continuation of the current map list item (2+ space indent).
    const continuationMatch = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (continuationMatch && currentListItem) {
      const k = continuationMatch[1] ?? "";
      const v = (continuationMatch[2] ?? "").trim();
      currentListItem[k] = parseScalarOrInlineList(v);
      continue;
    }

    // Anything else = shape we don't handle.
    return null;
  }

  flushList();
  return root;
}

function parseScalarOrInlineList(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) return [];
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  return parseScalar(trimmed);
}

function parseScalar(raw: string): unknown {
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

function parseMarkdown(source: string): ParsedMarkdown | null {
  const split = splitFrontmatter(source);
  if (!split) return null;
  const frontmatter = parseYamlSubset(split.raw);
  if (!frontmatter) return null;
  return { frontmatter, body: split.body };
}

// ─── Body section extraction ──────────────────────────────────────────────────

const WHAT_CHANGED_HEADING = "## What changed";
const NOTES_HEADING = "## Notes for future agents";

function extractBodySections(body: string): EntryBody {
  const whatChanged = extractSection(body, WHAT_CHANGED_HEADING, NOTES_HEADING);
  const notesForAgents = extractSection(body, NOTES_HEADING, null);
  return {
    whatChanged: whatChanged.trim(),
    notesForAgents: notesForAgents.trim(),
  };
}

function extractSection(body: string, startHeading: string, endHeading: string | null): string {
  const startIdx = body.indexOf(startHeading);
  if (startIdx === -1) return "";
  const afterStart = body.slice(startIdx + startHeading.length);
  if (!endHeading) return afterStart;
  const endIdx = afterStart.indexOf(endHeading);
  if (endIdx === -1) return afterStart;
  return afterStart.slice(0, endIdx);
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const syncActionSchema = z.object({
  kind: z.enum(SYNC_ACTION_KINDS),
  detail: z.string().min(1),
});

const prSchema = z.union([z.number().int().positive(), z.literal("unmerged")]);

const entryBodySchema = z.object({
  whatChanged: z.string().min(1),
  notesForAgents: z.string().min(1),
});

const entrySchema = z.object({
  pr: prSchema,
  branch: z.string().min(1),
  merged_at: z.string().min(1).optional(),
  category: z.enum(CATEGORIES),
  scopes: z.array(z.string().min(1)),
  breaking: z.boolean(),
  sync_actions: z.array(syncActionSchema),
  touched_domains: z.array(z.string().min(1)),
  issue_refs: z.array(z.string().min(1)),
  body: entryBodySchema,
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Accepts either:
 *   - a raw markdown string (parses YAML frontmatter + body sections), or
 *   - a partially-typed object (frontmatter fields already extracted, with
 *     an optional `body: { whatChanged, notesForAgents }`).
 *
 * Returns Result<Entry, ValidationError>. Never throws.
 */
export function validate(input: unknown): Result<Entry, ValidationError> {
  const normalized = normalizeInput(input);
  if (!normalized.success) return normalized;

  const parsed = entrySchema.safeParse(normalized.data);
  if (!parsed.success) {
    return toValidationError(parsed.error);
  }

  const entry = withSortedSyncActions(parsed.data);
  return {
    success: true,
    data: entry,
    message: "Changelog entry is valid.",
  };
}

function normalizeInput(input: unknown): Result<Record<string, unknown>, ValidationError> {
  if (typeof input === "string") {
    const parsed = parseMarkdown(input);
    if (!parsed) {
      return {
        success: false,
        error: {
          code: "INVALID_FRONTMATTER",
          message:
            "Could not parse YAML frontmatter — file must start with a `---` fence and use the supported subset.",
        },
        message: "Invalid frontmatter.",
      };
    }
    const merged: Record<string, unknown> = {
      ...parsed.frontmatter,
      body: extractBodySections(parsed.body),
    };
    return { success: true, data: merged, message: "Parsed markdown." };
  }

  if (input && typeof input === "object") {
    return {
      success: true,
      data: input as Record<string, unknown>,
      message: "Accepted object input.",
    };
  }

  return {
    success: false,
    error: {
      code: "INVALID_FRONTMATTER",
      message: "Input must be a markdown string or an object.",
    },
    message: "Unsupported input type.",
  };
}

function toValidationError(error: z.ZodError): Result<Entry, ValidationError> {
  const issue = error.issues[0];
  if (!issue) {
    return {
      success: false,
      error: { code: "INVALID_FRONTMATTER", message: "Unknown validation error." },
      message: "Validation failed.",
    };
  }

  const field = issue.path.map((segment) => String(segment)).join(".");
  const code = classifyIssue(issue, field);
  const message = buildMessage(issue, field);

  return {
    success: false,
    error: { code, field: field.length > 0 ? field : undefined, message },
    message,
  };
}

function classifyIssue(issue: z.ZodIssue, field: string): ValidationError["code"] {
  if (issue.code === "invalid_type" && /required|undefined/i.test(issue.message)) {
    return "MISSING_FIELD";
  }
  if (field === "category") return "INVALID_CATEGORY";
  if (field.startsWith("sync_actions") && field.endsWith("kind")) return "INVALID_KIND";
  return "INVALID_FRONTMATTER";
}

function buildMessage(issue: z.ZodIssue, field: string): string {
  const location = field.length > 0 ? ` at \`${field}\`` : "";
  return `${issue.message}${location}`;
}

function withSortedSyncActions(entry: Entry): Entry {
  const sorted: SyncAction[] = [...entry.sync_actions].sort((a, b) => {
    const kindDelta = SYNC_ACTION_ORDER[a.kind] - SYNC_ACTION_ORDER[b.kind];
    if (kindDelta !== 0) return kindDelta;
    return a.detail.localeCompare(b.detail);
  });
  return { ...entry, sync_actions: sorted };
}

// ─── Re-exports for consumers ────────────────────────────────────────────────

export type { Category, Entry, SyncAction, SyncActionKind, ValidationError };

// ─── CLI: `bun run scripts/changelog/validate.ts --lint-pending` ──────────────
//
// Iterates every `changelog/pending/*.md`, runs validate() on each, and prints
// a report. Exits 0 when every entry parses; exits 1 with a per-file summary
// when any entry fails. Used by the root `changelog:validate` script and
// therefore by `.husky/pre-push` as the primary gate.

const PENDING_DIR = "changelog/pending";
const LINT_FLAG = "--lint-pending";

async function lintPendingDirectory(): Promise<number> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  let entries: string[];
  try {
    entries = await readdir(PENDING_DIR);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`changelog:validate: cannot read ${PENDING_DIR}/ — ${message}\n`);
    return 1;
  }

  const markdownFiles = entries.filter((name) => name.endsWith(".md"));
  if (markdownFiles.length === 0) {
    process.stdout.write(`changelog:validate: no entries in ${PENDING_DIR}/ — nothing to lint.\n`);
    return 0;
  }

  const failures: Array<{ file: string; message: string }> = [];
  for (const name of markdownFiles) {
    const path = join(PENDING_DIR, name);
    const source = await readFile(path, "utf8");
    const result = validate(source);
    if (!result.success) {
      failures.push({ file: path, message: result.error.message });
      continue;
    }
    process.stdout.write(`  ok  ${path}\n`);
  }

  if (failures.length === 0) {
    process.stdout.write(
      `changelog:validate: ${markdownFiles.length} entr${markdownFiles.length === 1 ? "y" : "ies"} valid.\n`,
    );
    return 0;
  }

  process.stderr.write(
    `\nchangelog:validate: ${failures.length} invalid entr${failures.length === 1 ? "y" : "ies"}:\n`,
  );
  for (const failure of failures) {
    process.stderr.write(`  fail  ${failure.file}\n         ${failure.message}\n`);
  }
  return 1;
}

if (import.meta.main && process.argv.includes(LINT_FLAG)) {
  lintPendingDirectory().then((code) => {
    process.exit(code);
  });
}
