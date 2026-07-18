---
name: changelog-notes
description: |
  Synthesize the "## Notes for future agents" section of a changelog entry
  after running `bun run changelog:draft`. Use when the drafter left the TBD
  prompt, or when the entry's notes read like a commit log instead of
  forward-guidance. Also use when opening a PR — the notes section belongs
  in the PR body so subsequent `changelog:draft` runs pick it up
  automatically.
user-invocable: true
argument-hint: "[pending-entry-path]"
---

# Changelog notes synthesis

## When this fires

- After `bun run changelog:draft` writes a `changelog/pending/*.md` whose
  `## Notes for future agents` is the TBD prompt
- When reviewing an existing entry that reads like a commit log instead of
  forward-guidance (bullets that restate commit subjects, dumps of PR body
  marketing copy, etc.)
- Immediately before opening a PR — the notes belong in the PR body so
  future re-runs of the drafter pick them up automatically

## What to write

**Forward-guidance for the next agent — never a log of what happened.**

The commits are on the PR (`gh pr view`, `git log`) and the diff is in
GitHub. Restating them here duplicates a story the reader already has cheap
access to. Your job is to capture what the diff and commits CAN'T reveal.

Target: a **3–8 line** synthesis. If you need more, you're logging, not
synthesizing.

**Include:**

- Non-obvious constraints — invariants a naive reader would break
- Hidden dependencies — "this only works because X in `convex/lib/y.ts`"
- Tradeoffs deliberately made — "we chose A over B because Y; if C ever
  changes, revisit"
- Things we tried that didn't work and why (the "we tried X and it broke Y")
- Deploy-order concerns — "this must land BEFORE PR #N, or migration Z
  fails"
- Test scaffolding assumptions — "the fixture at path/foo.ts assumes bar"
- Follow-up work the author knows about but didn't do

**Exclude:**

- "This PR adds X" / "Changed Y to Z" — that's on the PR
- Bullet list of the commits — that's on `gh pr view`
- File-by-file descriptions — that's on the diff
- "See CLAUDE.md for details" — link to it if load-bearing, but don't
  outsource the notes
- Marketing prose — you're writing for an agent, not a launch post

## Workflow

1. **Read the branch context**

   ```bash
   git log origin/main..HEAD --pretty=format:"%s%n%b%n---"
   git diff origin/main...HEAD --stat
   gh pr view --json title,body 2>/dev/null || true
   ```

2. **Identify the WHY**

   Ask: "If a future agent inherited this in 3 months, what would they need
   to know that they CAN'T reconstruct from git blame + diff?" That's the
   notes section.

3. **Sync to the PR body** (this is the load-bearing step)

   - If a PR exists: `gh pr edit <number> --body-file <path>` — write the
     synthesized notes under a `## Notes for future agents` heading in the
     PR body. This means the next `bun run changelog:draft` run
     automatically re-populates the entry from the PR body. Notes stay
     in ONE place.
   - If no PR yet: write the notes directly into the entry file. When you
     open the PR, include the same `## Notes for future agents` section in
     the PR body.

4. **Re-run the drafter to verify pickup**

   ```bash
   bun run changelog:draft --verbose
   ```

   The entry's `## Notes for future agents` should now match the PR body
   section (minus git trailers, which `draft.ts` strips).

## Structure recipe

Every notes section is one of these shapes — pick the one that fits, and
keep it short.

**"Invariant to preserve":**

> The migration widens `contracts.tenantId` in this PR and narrows the schema
> in a follow-up (#NNN). Do not merge the follow-up until this backfill has
> completed everywhere — the schema narrow will fail validation on any doc
> that still has the pre-widen shape.

**"Load-bearing constraint":**

> `assertReleaseReadyBranch()` refuses to run from a feature branch — this
> is intentional. If you're tempted to bypass it in CI, the invariant that
> `main` is the source of truth for release tags depends on it. Move the
> release invocation to a workflow instead of loosening the guard.

**"We tried X and it didn't work":**

> First attempt used `git worktree add` from the workflow script; agents in
> parallel wrote to a sibling worktree because subagent CWD didn't propagate.
> The workaround is `EnterWorktree` on the main-loop, not from within the
> Workflow tool. If you find yourself reaching for `git worktree` from a
> spawned agent, don't.

**"Deploy order":**

> Sync-actions include `env: NEW_ETHERFUSE_TOKEN`. This env var MUST be set
> on the Convex deployment BEFORE the code is deployed, or the analyzer
> fail-closes. Order: `bun run convex:env:sync` → then push.

## Non-goals

This skill does NOT:

- Fill in `## What changed` — that's a one-liner the drafter produces from
  the PR title
- Write frontmatter — the drafter emits that deterministically from
  filesystem signals
- Publish the entry — that happens at merge; the pre-push hook validates
  it and `bun run changelog:release` aggregates it later

## Related

- `bun run changelog:draft` — the mechanical drafter (frontmatter + one-liner)
- `bun run changelog:validate` — schema check the pre-push hook runs
- `docs/architecture/changelog.md` — full spec of the entry format
- `.claude/hooks/changelog-required.js` — the PreToolUse gate that blocks
  `gh pr create` without an entry
