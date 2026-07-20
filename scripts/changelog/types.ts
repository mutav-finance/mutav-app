/**
 * Minimum-viable changelog entry — start-small, prove-the-value shape.
 *
 * The load-bearing feature is `sync_actions`: a mechanical runbook emitted
 * deterministically by filesystem-signal detectors (see signals.ts). Everything
 * else is metadata to make the banner + agent context readable.
 *
 * Explicitly OUT of scope (deleted from the earlier design):
 *   - Body sections (`## What changed` / `## Notes for future agents`) —
 *     agent-authored narrative was aspirational; ship without and add back
 *     if entries prove to be a durable source of "why" context.
 *   - Release aggregation — no versioned-release ritual today.
 *   - PR-blocking sensors — start with soft encouragement, add enforcement
 *     if entries get skipped.
 *
 * See docs/architecture/changelog.md.
 */

export type SyncActionKind = "env" | "install" | "seed" | "migrate" | "run" | "manual";

export type Category = "feat" | "fix" | "refactor" | "perf" | "chore" | "docs" | "test";

export const SYNC_ACTION_KINDS = ["env", "install", "seed", "migrate", "run", "manual"] as const;

export const CATEGORIES = ["feat", "fix", "refactor", "perf", "chore", "docs", "test"] as const;

/**
 * Deterministic ordering for `sync_actions[]` — env → install → seed →
 * migrate → run → manual. Sync-notice.mjs and the SessionStart hook each
 * mirror this so surfaces read predictably; validate.test.ts asserts the
 * three copies stay aligned.
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

/**
 * Six fields — three required, three optional. Frontmatter-only; no body.
 *
 *   - `branch` keys the entry (one-per-branch); the drafter reuses the
 *     existing filename on re-runs.
 *   - `category` groups entries in the banner (`feat`, `fix`, etc.).
 *   - `summary` is the one-line synthesis — PR title (prefix-stripped)
 *     when a PR exists, otherwise the most recent commit subject.
 *   - `pr` becomes a number once the PR opens; unset before that.
 *   - `merged_at` (ISO date) drives the seen-marker filter in
 *     sync-notice.mjs; when missing, the file's mtime is used.
 *   - `sync_actions[]` is the runbook Draau (and any agent) needs on
 *     `git pull`.
 */
export type Entry = {
  branch: string;
  category: Category;
  summary: string;
  pr?: number | "unmerged";
  merged_at?: string;
  sync_actions: SyncAction[];
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
 * Result pattern — mirrors convex/lib/result.ts. Local so scripts/ files
 * (which can't import from convex/ or from an app's src/) share the same
 * shape as the rest of the repo.
 */
export type ResultSuccess<T> = { success: true; data: T; message: string };
export type ResultError<E> = { success: false; error: E; message: string };
export type Result<TData, TError> = ResultSuccess<TData> | ResultError<TError>;
