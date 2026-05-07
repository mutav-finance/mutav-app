# Contributing

Thanks for working on SGR. This file is the short, actionable version —
keep it open in a tab, follow it, ship.

## Prerequisites

- [Bun ≥ 1.3](https://bun.sh) — package manager + script runner
- A Convex account (free tier is fine for dev)
- macOS or Linux. Windows via WSL.

If `bun --version` works and you've run `bun install` at the repo root,
you're set.

## Local development

```bash
bun dev
```

That's it. One command starts Next.js (port 3000) and the Convex dev
backend together. Logs are prefixed `web` / `cvx` and color-coded so you
can tell who said what. If either side dies, both shut down — no
zombie processes.

If you need to run them separately:

```bash
bun run dev:web      # Next.js only
bun run dev:convex   # Convex only
```

## Branch workflow

1. Branch off `main`:
   ```bash
   git checkout -b feat/<short-description>
   ```
   Prefixes: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.

2. Commit early, commit often. Don't worry about a clean history yet —
   we squash on merge.

3. Open a PR against `main` when ready. CI must pass.

4. **Squash merge.** The PR title becomes the commit message on `main`,
   so make it good (see below).

## Commit / PR title style

Conventional Commits with a scope:

```
feat(convex): wire backend schema and seed
fix(auth): handle Privy session expiry on refresh
chore(deps): bump next to 16.2.5
docs(readme): add bun setup instructions
```

Common scopes in this repo: `convex`, `auth`, `ui`, `security`, `deps`,
`docs`, `ci`.

The body (optional) explains **why**, not what — the diff already shows
what changed.

## Code standards

- **TypeScript strict.** No `any` without a comment explaining why.
- **ESLint passes.** `bun run lint` before pushing.
- **No new dependencies without a reason.** Prefer the platform; if
  you do add one, note it in the PR description and check transitive
  CVEs (`bun pm ls` / `npm audit` against a temporary npm install).
- **Don't commit secrets.** `.env.local` is gitignored — keep it that way.

## Convex notes

When touching anything under `convex/`, read
[`convex/_generated/ai/guidelines.md`](./convex/_generated/ai/guidelines.md)
first. Convex has rules that override generic Node/SQL intuition
(query/mutation/action separation, validators, indexes, etc.).

Schema changes that touch existing data need a migration — see
[`@convex-dev/migrations`](https://www.convex.dev/components/migrations).

## PR checklist

Before requesting review:

- [ ] `bun run lint` passes
- [ ] `bun run build` passes
- [ ] You've used the feature in a browser (for UI changes)
- [ ] PR title follows the commit style above
- [ ] Description explains the **why** and links any related issue
- [ ] No `console.log` / debug code left behind
- [ ] No new lockfiles other than `bun.lock`

## Questions

Open a draft PR with your work-in-progress and tag a maintainer — easier
to review code than to discuss in the abstract.
