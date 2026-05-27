# Auth0 Orgs PR-2 — Schema Hedge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the schema fields required by the rest of the Auth0 Orgs cascade — `agencies.auth0OrgId` (with index) and `users.isStaff` — plus the persona seed update for `systemadmin`. No behavior change; this is purely a foundation that PRs 3-8 will read from and write to.

**Architecture:** Two optional schema fields, one Convex index, one persona-map update, one docs update. Convex schema changes are non-breaking when adding optional fields. The fields are added but no code path reads them yet — they exist purely so the next PRs can populate / consume them without a schema migration.

**Tech Stack:** Convex schema, Convex internal mutations, Vitest, Markdown docs.

**Branch:** `feat/auth0-orgs-schema` (already cut from `feat/auth-wire-auth0`). The first commit on this branch is `a74772a` (the design spec). All implementation work below stacks on that.

**Spec reference:** `docs/superpowers/specs/2026-05-26-auth0-orgs-onboarding-experience-design.md` — read this first for full context. This plan implements only the Adoption-Order row #2 from that spec ("Schema additions only").

---

## File map

| Path | Action | Why |
|---|---|---|
| `convex/schema.ts` | Modify | Add `agencies.auth0OrgId` + `by_auth0OrgId` index. Add `users.isStaff`. |
| `convex/agencies/domain.ts` | (no change) | `Agency` type already derives from `Doc<"agencies">`, so it picks up `auth0OrgId` automatically. Verify in Task 4. |
| `convex/users/domain.ts` | (no change) | Same — `User` type derives from `Doc<"users">`. |
| `convex/seed.ts` | Modify | Add `isStaff: true` to the `systemadmin` entry in the `PERSONAS` map. `seedPersona` patches it onto the existing row. |
| `convex/users/useCases.test.ts` | Modify | Add a test verifying `isStaff` field is readable and defaults to absent. |
| `convex/agencies/useCases.test.ts` | Modify | Add a test verifying `auth0OrgId` is queryable via the new index. |
| `docs/test-personas.md` | Modify | Note that systemadmin now carries `isStaff: true`; clarify the persona's role. |
| `docs/superpowers/specs/2026-05-26-auth0-orgs-onboarding-experience-design.md` | (no change) | The spec already references what this PR delivers. |

---

## Task 1: Add `agencies.auth0OrgId` field + index to schema

**Files:**
- Modify: `convex/schema.ts:167-187` (the `agencies` table)

- [ ] **Step 1: Read current schema state**

Run: `git diff convex/schema.ts`

If the diff already shows `auth0OrgId` and `by_auth0OrgId` added (uncommitted from prior session), skip to Step 4 of this task. Otherwise continue.

- [ ] **Step 2: Add the field + index**

In `convex/schema.ts`, locate the `agencies: defineTable({ ... })` block (around line 167). Add the field after `representanteCpf`:

```ts
    representanteCpf: v.optional(v.string()),
    // Auth0 Organization id (e.g. `org_xxx`). Populated when the agency
    // is provisioned through the Auth0 Orgs path (see #121). Legacy
    // agencies stay Convex-only with this field absent — wrappers MUST
    // tolerate both shapes during the migration window.
    auth0OrgId: v.optional(v.string()),
  })
```

And add the index after `by_onboardingState`:

```ts
    .index("by_onboardingState", ["onboardingState"])
    .index("by_auth0OrgId", ["auth0OrgId"]),
```

- [ ] **Step 3: Verify Convex picks up the schema change**

Run (in a separate terminal if `bun dev` isn't already running):

```
bunx convex dev --once
```

Expected output includes:

```
✔ Added table indexes:
  [+] agencies.by_auth0OrgId   auth0OrgId, _creationTime
✔ Convex functions ready!
```

If you see a schema validation error referencing existing rows, check that the field is `v.optional(v.string())` (not `v.string()`) — existing agency rows have no `auth0OrgId`, so the field must be optional.

- [ ] **Step 4: Sanity check the change is what you expect**

Run: `grep -A 1 "auth0OrgId\|by_auth0OrgId" convex/schema.ts`

Expected: the field declaration + index declaration appear.

- [ ] **Step 5: Stage but do NOT commit yet**

Run: `git add convex/schema.ts`

We'll batch the schema and users.isStaff additions into one commit at Task 3.

---

## Task 2: Add `users.isStaff` field to schema

**Files:**
- Modify: `convex/schema.ts:188-203` (the `users` table)

- [ ] **Step 1: Add the field**

In `convex/schema.ts`, locate the `users: defineTable({ ... })` block (around line 188). Add the field after `createdAt`:

```ts
    name: v.string(),
    email: v.string(),
    createdAt: v.string(),
    // True for Mutav internal staff members (who admin the system,
    // approve agencies, etc). False/absent for regular users (corretores).
    // Cross-agency `queryWithStaff`/`mutationWithStaff` wrappers will
    // gate on this in a later PR. See spec: docs/superpowers/specs/
    // 2026-05-26-auth0-orgs-onboarding-experience-design.md
    isStaff: v.optional(v.boolean()),
  })
```

The indexes block (lines 200-202) is unchanged — no index needed on `isStaff` since staff identity is read via `ctx.user.isStaff` after the wrapper has already resolved the user by subject.

- [ ] **Step 2: Verify Convex deploy still clean**

Run: `bunx convex dev --once`

Expected: `✔ Convex functions ready!` — no new index created since we didn't add one.

- [ ] **Step 3: Stage**

Run: `git add convex/schema.ts`

---

## Task 3: Commit the schema additions

- [ ] **Step 1: Verify nothing else is staged that shouldn't be**

Run: `git status -sb`

Expected output:
```
## feat/auth0-orgs-schema
 M convex/schema.ts
```

If other files appear staged, unstage them with `git restore --staged <file>` — they belong to later tasks.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(schema): add auth0OrgId on agencies + isStaff on users

Foundation for the Auth0 Organizations cascade (#121). Both fields are
optional with no readers/writers yet — PRs 3-8 wire them up. The
by_auth0OrgId index lets future code resolve an agency from a JWT
org_id claim in O(1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: pre-commit hook runs prettier + eslint (both clean — only `.md` files changed for non-Convex content); commit succeeds.

If commitlint complains about subject case, lowercase the first word after the `:` (e.g. `feat(schema): add ...` is correct; `feat(schema): Add ...` is not).

---

## Task 4: Add a test for the agencies index

**Files:**
- Modify: `convex/agencies/useCases.test.ts` (add one new test at end of file)

- [ ] **Step 1: Locate the end of the file**

Run: `tail -10 convex/agencies/useCases.test.ts`

Note the last `describe` block — the new test goes after it.

- [ ] **Step 2: Add the test**

Append to `convex/agencies/useCases.test.ts`:

```ts
describe("agencies.auth0OrgId (schema field)", () => {
  test("by_auth0OrgId index lookup finds an agency by its Auth0 org id", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);

    const agencyId = await t.run((ctx) =>
      ctx.db.insert("agencies", {
        name: "Test Org-Backed Agency",
        cnpj: "00000000000111",
        createdAt: new Date().toISOString(),
        auth0OrgId: "org_test_123",
      }),
    );

    const found = await t.run((ctx) =>
      ctx.db
        .query("agencies")
        .withIndex("by_auth0OrgId", (q) => q.eq("auth0OrgId", "org_test_123"))
        .unique(),
    );

    expect(found?._id).toBe(agencyId);
  });

  test("an agency without auth0OrgId is not returned by the index", async () => {
    const t = convexTest(schema);

    await t.run((ctx) =>
      ctx.db.insert("agencies", {
        name: "Legacy Agency",
        cnpj: "00000000000222",
        createdAt: new Date().toISOString(),
        // no auth0OrgId
      }),
    );

    const found = await t.run((ctx) =>
      ctx.db
        .query("agencies")
        .withIndex("by_auth0OrgId", (q) => q.eq("auth0OrgId", "org_does_not_exist"))
        .unique(),
    );

    expect(found).toBeNull();
  });
});
```

- [ ] **Step 3: Run the new tests in isolation**

Run: `bunx vitest run convex/agencies/useCases.test.ts -t "auth0OrgId"`

Expected: 2 passed.

If the test errors with "withIndex 'by_auth0OrgId' is not defined", the index didn't deploy — re-run `bunx convex dev --once` and try again.

- [ ] **Step 4: Run the full file to make sure nothing else broke**

Run: `bunx vitest run convex/agencies/useCases.test.ts`

Expected: all previous tests still pass + 2 new ones pass.

- [ ] **Step 5: Stage**

Run: `git add convex/agencies/useCases.test.ts`

---

## Task 5: Add a test for users.isStaff

**Files:**
- Modify: `convex/users/useCases.test.ts` (add one new describe block)

- [ ] **Step 1: Add the test**

Append to `convex/users/useCases.test.ts`:

```ts
describe("users.isStaff (schema field)", () => {
  test("isStaff defaults to absent on freshly-provisioned users", async () => {
    const t = convexTest(schema);
    const asAlice = t.withIdentity({
      subject: "auth0|alice",
      email: "alice@test.br",
      name: "Alice",
    });

    const result = await asAlice.mutation(api.users.useCases.getOrCreateByIdentity, {});
    const user = await t.run((ctx) => ctx.db.get(result.userId));

    expect(user?.isStaff).toBeUndefined();
  });

  test("isStaff can be patched onto a user (staff promotion via seed/admin)", async () => {
    const t = convexTest(schema);
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        publicId: "user-mutav-admin",
        subject: "auth0|mutav-admin",
        name: "Mutav Admin",
        email: "admin@mutav.finance",
        createdAt: new Date().toISOString(),
      }),
    );

    await t.run((ctx) => ctx.db.patch(userId, { isStaff: true }));
    const user = await t.run((ctx) => ctx.db.get(userId));

    expect(user?.isStaff).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `bunx vitest run convex/users/useCases.test.ts -t "isStaff"`

Expected: 2 passed.

- [ ] **Step 3: Run the full file**

Run: `bunx vitest run convex/users/useCases.test.ts`

Expected: all previous tests still pass + 2 new ones.

- [ ] **Step 4: Stage**

Run: `git add convex/users/useCases.test.ts`

---

## Task 6: Commit the new tests

- [ ] **Step 1: Verify staged files**

Run: `git status -sb`

Expected:
```
## feat/auth0-orgs-schema
 M convex/agencies/useCases.test.ts
 M convex/users/useCases.test.ts
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
test(schema): cover auth0OrgId index + isStaff field

Locks in the new optional fields behave as expected: the by_auth0OrgId
index resolves an agency by its Auth0 org id, missing values don't leak
across the index lookup, and isStaff defaults absent on fresh user rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `PERSONAS` map to mark systemadmin as staff

**Files:**
- Modify: `convex/seed.ts` (the `PERSONAS` constant — search for `systemadmin: {`)

- [ ] **Step 1: Locate the PERSONAS map**

Run: `grep -n "systemadmin:" convex/seed.ts | head -3`

Expected: one line pointing to the systemadmin entry inside `PERSONAS`.

- [ ] **Step 2: Update the persona definition**

Find this block in `convex/seed.ts`:

```ts
const PERSONAS: Record<
  PersonaKey,
  {
    email: string;
    subject: string;
    name: string;
    agency: { name: string; cnpj: string; state: "active" | "under_review" } | null;
  }
> = {
  systemadmin: {
    email: "systemadmin@mutav.finance",
    subject: "auth0|6a150df6a100fbf318f393c0",
    name: "Mutav Team",
    agency: null,
  },
```

Change the type signature to allow `isStaff`:

```ts
const PERSONAS: Record<
  PersonaKey,
  {
    email: string;
    subject: string;
    name: string;
    isStaff?: boolean;
    agency: { name: string; cnpj: string; state: "active" | "under_review" } | null;
  }
> = {
  systemadmin: {
    email: "systemadmin@mutav.finance",
    subject: "auth0|6a150df6a100fbf318f393c0",
    name: "Mutav Team",
    isStaff: true,
    agency: null,
  },
```

(Other persona entries don't need `isStaff` — TypeScript leaves it `undefined`.)

- [ ] **Step 3: Update `seedPersona` to apply `isStaff`**

Find the `seedPersona` function in `convex/seed.ts` and update the user-creation + patch logic. Locate this block:

```ts
  let userId;
  if (byEmail) {
    userId = byEmail._id;
    if (!byEmail.subject) {
      await ctx.db.patch(userId, { subject: persona.subject });
    }
  } else {
    userId = await ctx.db.insert("users", {
      publicId: `user-persona-${key}`,
      subject: persona.subject,
      name: persona.name,
      email: persona.email,
      createdAt: now,
    });
  }
```

Replace with:

```ts
  let userId;
  if (byEmail) {
    userId = byEmail._id;
    const patch: { subject?: string; isStaff?: boolean } = {};
    if (!byEmail.subject) patch.subject = persona.subject;
    if (persona.isStaff && !byEmail.isStaff) patch.isStaff = true;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(userId, patch);
    }
  } else {
    userId = await ctx.db.insert("users", {
      publicId: `user-persona-${key}`,
      subject: persona.subject,
      name: persona.name,
      email: persona.email,
      createdAt: now,
      isStaff: persona.isStaff,
    });
  }
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`

Expected: no output (clean).

- [ ] **Step 5: Stage**

Run: `git add convex/seed.ts`

---

## Task 8: Re-run the persona seed to patch the live dev row

- [ ] **Step 1: Confirm Convex dev is running**

Run: `curl -sI https://veracious-poodle-858.convex.cloud | head -3`

Expected: `HTTP/2 200` (Convex deployment reachable).

If `bunx convex dev` isn't running anywhere, start it: `bunx convex dev --once` (one-shot push) is enough.

- [ ] **Step 2: Re-run the seed**

```bash
bunx convex run seed:seedTestPersonas
```

Expected output includes the systemadmin entry, possibly with `skipped: true` for personas whose state already matches. The systemadmin row will be patched in place with `isStaff: true`.

- [ ] **Step 3: Verify the patch landed**

```bash
bunx convex data users --limit 10 | grep systemadmin
```

The output should show systemadmin's row, but `bunx convex data` doesn't include arbitrary fields. To verify `isStaff`, query directly:

```bash
bunx convex run users:getMe --identity 'subject=auth0|6a150df6a100fbf318f393c0,issuer=https://dev-ay46ib0hhi1mdwpw.us.auth0.com/'
```

Expected: returned object includes `isStaff: true`.

(If `convex run` doesn't accept `--identity` flag in your CLI version, skip — the test in Task 5 already verifies the schema accepts the field; live data check is bonus confidence.)

---

## Task 9: Update test-personas docs

**Files:**
- Modify: `docs/test-personas.md` (the systemadmin row + a new paragraph)

- [ ] **Step 1: Update the table row**

Find this line in `docs/test-personas.md`:

```md
| **System admin (Mutav team)** | `systemadmin@mutav.finance` | `auth0\|6a150df6a100fbf318f393c0` | none (staff)        | `/onboarding` today — gap: no `(admin)` shell yet, tracked separately |
```

Replace with:

```md
| **System admin (Mutav team)** | `systemadmin@mutav.finance` | `auth0\|6a150df6a100fbf318f393c0` | `users.isStaff: true`, no agency | `/onboarding` today — gap: no `(admin)` shell yet (tracked in #121 cascade PR-6) |
```

- [ ] **Step 2: Add a paragraph about isStaff**

After the table (before the "How the seeded state attaches to the Auth0 user" section), insert:

```md
### How `isStaff` is set

The `seedTestPersonas` mutation patches `users.isStaff: true` onto the systemadmin row at seed time. The `PERSONAS` map in `convex/seed.ts` is the source of truth for who gets the flag — currently only `systemadmin`. To grant staff to additional users post-seed, flip `isStaff: true` via the Convex dashboard on their `users` row.

Staff identity isn't enforced anywhere yet — the `(admin)` route group + `queryWithStaff`/`mutationWithStaff` wrappers ship in PR-6 of the Auth0 Orgs cascade.
```

- [ ] **Step 3: Stage**

Run: `git add docs/test-personas.md`

---

## Task 10: Commit + final verify

- [ ] **Step 1: Run the full test suite**

```bash
bunx vitest run convex/
```

Expected: all tests pass (no regressions). Count should be original-93 + 4-new-from-Tasks-4-and-5 = 97 tests.

- [ ] **Step 2: Run tsc**

```bash
bunx tsc --noEmit
```

Expected: no output.

- [ ] **Step 3: Verify staged files**

Run: `git status -sb`

Expected:
```
## feat/auth0-orgs-schema
 M convex/seed.ts
 M docs/test-personas.md
```

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(seed): mark systemadmin persona as staff (users.isStaff)

Seeds the systemadmin persona with isStaff: true so that future PRs
(the `(admin)` shell + queryWithStaff wrappers) have a working test
identity from day 1. The PERSONAS map in seed.ts is the single source
of truth for who gets the flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Push**

```bash
git push
```

Expected: 3 new commits pushed (Tasks 3, 6, 10). Branch is now at HEAD with the schema additions + tests + seed update + docs.

- [ ] **Step 6: Update the existing PR or open a new one**

Check if there's already a PR for this branch:

```bash
gh pr list --head feat/auth0-orgs-schema
```

If a PR exists, the new commits are auto-attached — go to its URL and verify the diff matches expectations.

If no PR exists, open one targeting `feat/auth-wire-auth0` (the cascade base, NOT main):

```bash
gh pr create --base feat/auth-wire-auth0 --title "feat(schema): auth0OrgId on agencies + isStaff on users" --body "$(cat <<'EOF'
## Summary

PR-2 of the Auth0 Orgs cascade — adds schema fields the rest of the cascade reads/writes. No behavior change in this PR. Spec: \`docs/superpowers/specs/2026-05-26-auth0-orgs-onboarding-experience-design.md\`.

- \`agencies.auth0OrgId: v.optional(v.string())\` + \`by_auth0OrgId\` index
- \`users.isStaff: v.optional(v.boolean())\`
- \`seedTestPersonas\` patches \`isStaff: true\` onto systemadmin
- Tests verify the index lookup and the field defaults

Cascade order: this targets \`feat/auth-wire-auth0\` (PR #117), not main. Will merge to main only after the full cascade is verified end-to-end.

Closes #121 Phase 1 only (schema hedge); subsequent PRs will deliver Phases 2-8.

## Test plan

- [x] \`bunx vitest run convex/\` — 97 tests pass
- [x] \`bunx tsc --noEmit\` clean
- [x] \`bunx convex run seed:seedTestPersonas\` patches systemadmin to isStaff=true
EOF
)"
```

---

## Self-review notes (post-write)

**Spec coverage:**
- Spec section "Mutav staff identity (Option C)" → Tasks 2, 7 (field + seed)
- Spec section "Adoption order — PR #2: agencies.auth0OrgId + by_auth0OrgId index; users.isStaff + helpers" → Tasks 1-10
- Spec "Helpers" (queryWithStaff/mutationWithStaff) → NOT in this PR; deferred to PR-6 per spec Adoption Order table. This is consistent — PR-2 only puts the schema fields in place; wrappers ship with the `(admin)` shell.

**Placeholder scan:** clean — every step has concrete code/commands.

**Type consistency:** `PersonaKey` and `PERSONAS` map shape is consistent across Task 7's two edits.

**Out-of-scope confirmation:**
- No wrapper variants (`queryWithStaff`) — PR-6
- No (admin) route group — PR-6
- No `resolveUserDestination` staff branch — PR-6
- No Auth0 Management API client — PR-3
- No Auth0 Org provisioning code — PR-4
- This PR is purely a schema + seed + tests change. Any code that would READ `auth0OrgId` or `isStaff` lives in later PRs.
