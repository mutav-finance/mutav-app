/**
 * Shared types for the agent-facing changelog harness.
 *
 * See docs/superpowers/specs/2026-07-18-agent-facing-changelog-design.md
 * for the full design. This file is the single source of truth for the
 * entry shape consumed by validate.ts, signals.ts, draft.ts, release.ts,
 * and the .claude/hooks/changelog-*.js sensors.
 *
 * The Result<TData, TError> shape mirrors convex/lib/result.ts and
 * apps/agency/src/lib/result.ts so a caller narrows the same way on
 * either side of the wire.
 */

export type SyncActionKind = "env" | "install" | "seed" | "migrate" | "run" | "manual";

export type Category = "feat" | "fix" | "refactor" | "perf" | "chore" | "docs" | "test";

export const SYNC_ACTION_KINDS = ["env", "install", "seed", "migrate", "run", "manual"] as const;

export const CATEGORIES = ["feat", "fix", "refactor", "perf", "chore", "docs", "test"] as const;

/**
 * Deterministic ordering used when emitting sync_actions in an entry and when
 * rendering the sync-notice banner. Kept as a const record so it can be used
 * to key a stable sort without magic numbers.
 */
export const SYNC_ACTION_ORDER: Record<SyncActionKind, number> = {
  env: 0,
  install: 1,
  seed: 2,
  migrate: 3,
  run: 4,
  manual: 5,
};

export type SyncAction = {
  kind: SyncActionKind;
  detail: string;
};

export type EntryBody = {
  whatChanged: string;
  notesForAgents: string;
};

/**
 * The parsed, validated changelog entry. Mirrors the YAML frontmatter +
 * markdown body of a `changelog/pending/YYYY-MM-DD-<slug>.md` file.
 *
 * - `pr` is a number once a PR exists, or the literal "unmerged" while the
 *   branch has no PR yet. Kept as `number | "unmerged"` so consumers can
 *   discriminate without a nullable field.
 * - `merged_at` is ISO date (YYYY-MM-DD); omitted while the PR is open.
 */
export type Entry = {
  pr: number | "unmerged";
  branch: string;
  merged_at?: string;
  category: Category;
  scopes: string[];
  breaking: boolean;
  sync_actions: SyncAction[];
  touched_domains: string[];
  issue_refs: string[];
  body: EntryBody;
};

export type ValidationErrorCode =
  | "INVALID_FRONTMATTER"
  | "INVALID_KIND"
  | "MISSING_FIELD"
  | "INVALID_CATEGORY";

export type ValidationError = {
  code: ValidationErrorCode;
  field?: string;
  message: string;
};

/**
 * Result pattern — mirrors convex/lib/result.ts. Kept local so scripts/
 * files (which can't import from convex/ or from an app's src/) share the
 * exact same shape as the rest of the repo.
 */
export type ResultSuccess<T> = { success: true; data: T; message: string };
export type ResultError<E> = { success: false; error: E; message: string };
export type Result<TData, TError> = ResultSuccess<TData> | ResultError<TError>;
