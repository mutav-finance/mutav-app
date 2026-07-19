/**
 * Schema validation for `changelog/pending/*.md` entries.
 *
 * Shared by:
 *   - .husky/pre-push  → `bun run changelog:validate` (schema-shape guard)
 *
 * Parsing:
 *   - Entries are frontmatter-only — YAML `---` fenced block, no body.
 *   - Frontmatter parser is a small purpose-built YAML subset — the harness
 *     controls the shape (agent-authored via draft.ts), so we avoid pulling
 *     in gray-matter / js-yaml as a runtime dep.
 *
 * See docs/architecture/changelog.md for the schema spec.
 */

import { z } from "zod";
import {
  CATEGORIES,
  SYNC_ACTION_KINDS,
  SYNC_ACTION_ORDER,
  type Category,
  type Entry,
  type Result,
  type SyncAction,
  type SyncActionKind,
  type ValidationError,
} from "./types";

// ─── Non-trivial-diff heuristic ───────────────────────────────────────────────

const TRIVIAL_EXTENSIONS = [".md", ".mdx", ".txt"];
const TRIVIAL_PATH_PREFIXES = [".claude/notes/"];

/**
 * Returns true when the diff has at least one substantive change. Used by the
 * pre-push gate (and any future callers) to decide whether the "PR must have
 * a changelog entry" rule applies. Trivial cases skipped:
 *
 *   - Empty diff
 *   - Docs-only changes (only .md / .mdx / .txt files)
 *   - Notes-only changes (paths under .claude/notes/**)
 *
 * `diffStat` is the output of `git diff --name-only <base>...HEAD` — one path
 * per line.
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

/**
 * Splits a markdown string into the raw frontmatter block. Body is discarded —
 * entries are frontmatter-only. Returns null when the file doesn't start with
 * a `---` fence.
 */
function extractFrontmatter(source: string): string | null {
  // Strip UTF-8 BOM + normalize CRLF/CR → LF so a Windows-authored entry
  // parses identically to a Unix-authored one.
  const normalized = source.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith(FRONTMATTER_FENCE)) return null;

  const afterOpening = normalized.slice(FRONTMATTER_FENCE.length);
  const closingIndex = afterOpening.indexOf(`\n${FRONTMATTER_FENCE}`);
  if (closingIndex === -1) return null;

  return afterOpening.slice(0, closingIndex).replace(/^\n/, "");
}

/**
 * Purpose-built parser for the YAML subset the drafter emits:
 *   - `key: value` scalars (strings, numbers, booleans)
 *   - `key: [a, b, c]` inline lists of scalars
 *   - block lists via `- ` prefix
 *   - block maps two levels deep (`- key: value` entries)
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

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const syncActionSchema = z.object({
  kind: z.enum(SYNC_ACTION_KINDS),
  detail: z.string().min(1),
});

const prSchema = z.union([z.number().int().positive(), z.literal("unmerged")]);

const entrySchema = z.object({
  branch: z.string().min(1),
  category: z.enum(CATEGORIES),
  summary: z.string().min(1),
  pr: prSchema.optional(),
  merged_at: z.string().min(1).optional(),
  sync_actions: z.array(syncActionSchema),
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Accepts a raw markdown string OR an already-parsed object.
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
    const raw = extractFrontmatter(input);
    if (!raw) {
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
    const frontmatter = parseYamlSubset(raw);
    if (!frontmatter) {
      return {
        success: false,
        error: {
          code: "INVALID_FRONTMATTER",
          message: "Frontmatter contains YAML shapes outside the supported subset.",
        },
        message: "Invalid frontmatter.",
      };
    }
    return { success: true, data: frontmatter, message: "Parsed markdown." };
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

// ─── Re-exports ───────────────────────────────────────────────────────────────

export type { Category, Entry, SyncAction, SyncActionKind, ValidationError };

// ─── CLI: `bun run scripts/changelog/validate.ts --lint-pending` ──────────────
//
// Iterates every `changelog/pending/*.md`, runs validate() on each, and prints
// a report. Used by the root `changelog:validate` script and therefore by
// `.husky/pre-push` as the primary schema-shape gate.

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
