# Auth — Convex Function Wrappers

> Auth0 setup, env vars, tenants, rotation and troubleshooting live in [`auth0.md`](auth0.md). This doc covers the Convex-side wrappers and authorization model.

> Mutav uses custom Convex function wrappers from [convex-helpers](https://stack.convex.dev/custom-functions) to authenticate and agency-scope every public query and mutation. The wrappers resolve the calling user once, attach `user` / `membership` / `agencyId` to `ctx`, and fail closed on missing identity or membership. Identity is JWT-only via Auth0 — there is no dev-user fallback; a deployment without a real `AUTH0_DOMAIN` rejects every authenticated request. See [`apps/agency/src/lib/auth0.ts`](../apps/agency/src/lib/auth0.ts) and [`apps/admin/src/lib/auth0.ts`](../apps/admin/src/lib/auth0.ts) (both built on [`@mutav/app-shell/auth-callback`](../packages/app-shell/src/auth-callback.ts)), [`packages/app-shell/src/convex-auth-provider.tsx`](../packages/app-shell/src/convex-auth-provider.tsx), and [`convex/auth.config.ts`](../convex/auth.config.ts) for the wiring.

## The four wrappers + one helper

All live in [`convex/lib/auth.ts`](../convex/lib/auth.ts). Import from `../lib/auth` inside Convex (the `@` alias is not available in Convex modules).

| Wrapper / helper                    | Caller args added          | Handler `ctx` gains                                   | Use for                                                                                                                  |
| ----------------------------------- | -------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `queryWithAuth`                     | —                          | `user: User`                                          | Reads that don't depend on a specific agency (e.g. listing the current user's own agencies)                              |
| `mutationWithAuth`                  | —                          | `user: User`                                          | Writes that don't depend on a specific agency                                                                            |
| `queryWithAgencyScope`              | `agencyId: Id<"agencies">` | `user`, `membership`, `agencyId`                      | Reads scoped to one agency (the common case)                                                                             |
| `mutationWithAgencyScope`           | `agencyId: Id<"agencies">` | `user`, `membership`, `agencyId`                      | Writes scoped to one agency (the common case)                                                                            |
| `assertAgencyAccess(ctx, agencyId)` | —                          | returns `Membership`, throws `ForbiddenError` on miss | Inline check inside a bare `query`/`mutation` when `agencyId` is derived from a fetched resource rather than client args |

The wrapper consumes its declared args; the handler does not redeclare them. Callers still pass `{ agencyId, ...handlerArgs }`.

```ts
// convex/guarantees/useCases.ts
import { mutationWithAgencyScope } from "../lib/auth";

export const cancelDraft = mutationWithAgencyScope({
  args: { publicId: v.string() }, // agencyId is supplied by the wrapper
  handler: async (ctx, args) => {
    // ctx.user, ctx.membership, ctx.agencyId are guaranteed
    const guarantee = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    // NOT_FOUND covers both "no such id" and "exists in another agency"
    if (!guarantee || guarantee.agencyId !== ctx.agencyId) {
      return { success: false, error: { code: "NOT_FOUND" } } as const;
    }
    // ...
  },
});
```

```ts
// Client call — still passes agencyId, no change
await cancelDraft({ agencyId: guarantee.agencyId, publicId: guarantee.publicId });
```

## The resource-by-id pattern (`assertAgencyAccess`)

Some routes only know a resource's public id, not its agency — e.g. `/guarantees/[publicId]` is deep-linkable and renders server-side via `preloadQuery`. The client has no way to pass `agencyId` along with `publicId` from the URL, so the wrapper can't pre-scope by args.

For these, use a bare `query` + inline `assertAgencyAccess` against the resource's own `agencyId`:

```ts
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const guarantee = await ctx.db
      .query("guarantees")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!guarantee) return null;

    // Returns null on both "no such id" and "not a member of that agency"
    // — never leak cross-agency existence.
    try {
      await assertAgencyAccess(ctx, guarantee.agencyId);
    } catch {
      return null;
    }

    // ...build and return the shaped response
  },
});
```

The `try`/`catch` exists because `assertAgencyAccess` throws `ForbiddenError`. Resource-by-id queries swallow it and return `null` to avoid leaking which ids exist in other agencies. Mutations using `assertAgencyAccess` should let the throw propagate — they're never reachable from a legitimate UI path.

## Identity resolution: JWT-only, fail closed

`resolveCurrentUser(ctx)` in [`convex/lib/auth.ts`](../convex/lib/auth.ts) reads `ctx.auth.getUserIdentity()` and looks up the row by `users.subject`. If the JWT is missing or the lookup misses, it throws `UnauthenticatedError`. There is **no fallback row** — a deployment without a real `AUTH0_DOMAIN` rejects every wrapped handler.

### Required env vars (Convex side): empty is OK, missing is not

**Convex requires `AUTH0_DOMAIN` and `AUTH0_CLIENT_ID` to be SET on every deployment**, including dev. The value may be empty (`""`); only the existence of the var matters to Convex's deploy-time analyzer.

Convex's analyzer scans `auth.config.ts` (and everything it imports transitively) for `process.env.X` references. Any reference makes Convex refuse to deploy unless that var is present in the deployment's env. Wrapping the read in a getter function (the `getAuth0Domain()` pattern in `convex/lib/env.ts`) does **not** dodge this — the analyzer follows call chains. That was the root cause of PR #75's rollback; do not assume the lazy-getter wrapping helps here.

An empty string satisfies the analyzer but registers no provider — every wrapped handler then throws (fail-closed). That's fine for previews that aren't expected to authenticate; a real dev tenant needs the real values.

Setup commands:

```bash
# Satisfy the analyzer on previews that don't authenticate:
bunx convex env set AUTH0_DOMAIN ""
bunx convex env set AUTH0_CLIENT_ID ""

# Real tenant (dev / prod):
bunx convex env set AUTH0_DOMAIN your-tenant.auth0.com
bunx convex env set AUTH0_CLIENT_ID your-real-client-id
```

If `bunx convex dev` fails with `Environment variable AUTH0_DOMAIN is used in auth config file but its value was not set`, you forgot the set above. Run it once per Convex deployment (dev/preview/prod each get their own).

```ts
// convex/lib/auth.ts (simplified)
async function resolveCurrentUser(ctx: DbCtx): Promise<User> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new UnauthenticatedError(); // no JWT, no fallback
  const user = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .unique();
  if (!user) throw new UnauthenticatedError("not provisioned");
  return user;
}
```

### First-login provisioning

`users.getOrCreateByIdentity` ([`convex/users/useCases.ts`](../convex/users/useCases.ts)) is the idempotent provisioning entry point. It returns a `Result`. Resolution paths, in order:

1. Existing row with matching `subject` → return it.
2. Existing row with matching `email` and no `subject` → link it by patching the subject on, **only when the ID token says `email_verified: true`**. Otherwise → `EMAIL_NOT_VERIFIED`. Subjectless rows are seeded or tenant-cut rows that already hold agency memberships, so linking on an unverified email would hand those memberships to whoever typed the address.
3. Existing row with matching `email` and a different `subject` → `EMAIL_BOUND_TO_OTHER_IDENTITY`. No second row is inserted and nothing is merged.
4. No match → insert.

A JWT without an `email` claim is refused with `UnauthenticatedError`. Callers ignore the `Result` today: an error leaves `getMe` returning `null`, which the agency app shows as `/session-error?reason=not-provisioned`. The error codes live in `USER_ERROR_CODE` ([`convex/users/domain.ts`](../convex/users/domain.ts)); the tenant cut-over that relies on path 2 is in [`auth0.md`](auth0.md#119-tenant-cut-over-runbook).

Identity comes from `ctx.auth.getUserIdentity()` — never from client args. Accepting `subject` from args would let any authenticated user impersonate any other.

Two callsites:

- **Server-side** — the shared Auth0 `onCallback` hook ([`packages/app-shell/src/auth-callback.ts`](../packages/app-shell/src/auth-callback.ts), wired into each app's `src/lib/auth0.ts`) calls it once per successful OAuth callback via `ConvexHttpClient`. This is the canonical first-login path; the row is in place before the user lands on any authenticated route.
- **Server fallback (agency)** — `resolveUserDestination` in [`apps/agency/src/lib/user-destination.ts`](../apps/agency/src/lib/user-destination.ts) makes one provisioning attempt when `getMe` returns `null`, then reads `getMe` again; still `null` → `/session-error?reason=not-provisioned`.
- **Client fallback (agency)** — [`apps/agency/src/providers/workspace.tsx`](../apps/agency/src/providers/workspace.tsx) watches `getMe` returning `null` despite a valid Auth0 session and fires the mutation once per mount as a recovery path. Covers transient `onCallback` failures (Convex offline at login time, network blip) where the user has a valid session but no row.

### `users.getMe` vs. wrapped handlers

`getMe` (bare `query` in [`convex/users/useCases.ts`](../convex/users/useCases.ts)) is the only Convex query that intentionally returns `null` on missing identity or missing row. The UI needs the null to distinguish "loading", "signed out", and "signed in but unprovisioned" — wrapped handlers don't, they fail closed.

| Path                    | Returns                                         |
| ----------------------- | ----------------------------------------------- |
| JWT present, row found  | The user row                                    |
| JWT present, no row     | `null` (agency retries `getOrCreateByIdentity`) |
| JWT absent (signed out) | `null` (UI renders signed-out state)            |

### Wiring on the client

[`packages/app-shell/src/convex-auth-provider.tsx`](../packages/app-shell/src/convex-auth-provider.tsx) decides which Convex provider to render, from the `auth0Domain` prop each app passes in from its `NEXT_PUBLIC_AUTH0_DOMAIN` (inlined at build time):

- `NEXT_PUBLIC_AUTH0_DOMAIN` set → `<ConvexProviderWithAuth>` + `useAuthFromAuth0` hook that fetches the ID token from `/api/auth/convex-token` with `cache: "no-store"`. The route reads the encrypted session cookie and refreshes the ID token first when it is near expiry (see [`auth0.md`](auth0.md#id-token-refresh)).
- Unset → bare `<ConvexProvider>`. The Convex backend sees no JWT; every wrapped handler throws `UnauthenticatedError`.

Both halves are gated on the same env presence, so a mismatched config can't silently downgrade auth.

### Multi-entity Auth0 consideration (deferred to per-entity rollout)

The three-entity model from [`architecture/entities.md`](architecture/entities.md) (`Mutav-BR` + `Mutav-Fund` + `Mutav-Mgmt`) shows up at Auth0-swap time as a question about Auth0 application / tenant topology:

- **Single Auth0 application, multi-role JWT** (recommended for v1): one Auth0 tenant, one application, JWT carries role claims that map to `mutavStaff` rows scoped per entity via the role's entity tag. A user with `Mutav-BR:compliance` + `Mutav-Mgmt:treasury` holds two `mutavStaff` rows. The wrapper resolution is unchanged; only the provisioning maps Auth0 group → entity-scoped `mutavStaff` row.
- **Separate Auth0 applications per entity** (defer): one Auth0 tenant per legal entity, separate login flows, separate session cookies. Higher friction for cross-entity users (the founders, the v1 ops team); only justified if a regulator demands legal separation of the IDP layer or if the entities split operationally to different teams.

For v1 the single-application option is correct — same operations team serves all three entities, cross-entity roles are normal, and the entity scope lives in the `mutavStaff` row, not in the IDP. Revisit only if entity-level operational separation makes the single-tenant ergonomics painful.

Worth noting in this doc because the Auth0 swap PR is the natural moment to commit to the topology and accidentally choosing wrong creates churn.

## Auth0 Organizations — agency identity model

Each **imobiliária maps to one Auth0 Organization**, mirrored 1:1 to one Convex `agencies` row; each **corretor is one Auth0 user** mirrored to one `users` row. **Membership is canonical in Auth0** (the Org's member list + Org role `owner`/`admin`/`member`); the Convex `memberships` row is a **cached projection** synced at login/provisioning. Mutav-internal staff are Auth0 users with **no Organization** and one or more `mutavStaff` rows.

| Concept     | Auth0                 | Convex (projection)        |
| ----------- | --------------------- | -------------------------- |
| Imobiliária | Organization          | `agencies` row             |
| Corretor    | User                  | `users` row                |
| Membership  | Org member + Org role | `memberships` row (cached) |
| Mutav staff | User, no Org          | `mutavStaff` rows          |

**Org naming (no PII).** Auth0 Org `name = ag-<convex agency _id>` (globally unique, stable across renames, carries no PII); `display_name = agencies.name`; `metadata = { cnpj_hmac, agency_type, created_at }`, where `cnpj_hmac` uses the same HMAC pepper as `claimedDocuments` / `hashPii`. Never put the CNPJ or agency name in the Org `name`.

**JWT claim shape.** An Auth0 Post-Login Action injects `https://mutav.com/orgs` = `[{ id, display_name, role }]` (the user's agencies + role). When the user logs in scoped to exactly one Org (`?organization=…`), the native `org_id` claim is also present. **Wrappers prefer the custom `…/orgs` claim and fall back to native `org_id`.**

**Staff identity lives in Convex, not in Auth0.** Staff authority is the `mutavStaff` table (`userId`, `role`, `createdAt`, optional `addedBy`; indexes `by_user`, `by_user_role`, `by_role`), one row per (user, role). See [Admin authorization model](#admin-authorization-model) below for the wrappers, the identity reads and how rows are granted. **Graduate to Auth0 Roles** when any of these holds: staff count exceeds ~10; granular per-permission roles are needed (auditor / regional-admin); or an external auditor / compliance officer needs scoped, time-limited access.

**Migration tolerance (no breaking moment).** `queryWithAgencyScope` / `mutationWithAgencyScope` MUST tolerate both shapes during rollout: `agencies.auth0OrgId === undefined` (legacy agency → fall back to the Convex `memberships` projection) and `auth0OrgId === "org_…"` (prefer the JWT Org claim). Schema has landed: `agencies.auth0OrgId` + `by_auth0OrgId` index. `users.isStaff` is deprecated: nothing reads or writes it, and it stays optional in the schema only until a clear-then-narrow migration removes it.

> Decision origin (Org-name-no-PII; the original `users.isStaff` flag was superseded by the `mutavStaff` table): this section is the durable record (the brainstorm spec was transient and is no longer tracked).

## Strict compliance — the rule

**Every public `query` or `mutation` that touches agency-scoped data MUST use a wrapper.** No bare `query({ args, handler })` for new handlers. The two allowed exceptions:

1. **Resource-by-id reads/writes** (the `getByPublicId` pattern) — bare `query`/`mutation` + inline `assertAgencyAccess`. The wrapper can't help because `agencyId` comes from the resource, not args.
2. **`internalMutation` / `internalQuery`** (the `convex/guarantees/mutations.ts` pattern) — internal-only writers called via `ctx.runMutation(internal.…)`. Auth was already enforced by the public caller; internals don't re-check.

Everything else: wrapper. PRs that add a bare public `query`/`mutation` for an agency-scoped handler should be rejected at review.

For `ActionCtx` (no `ctx.db`, can't query memberships), use the lower-level `requireIdentity(ctx)` helper for the identity check, and call an `internalQuery` for the membership lookup. Action-level wrappers may be added later; for now actions are rare enough to handle case-by-case.

## Calling wrapped functions from actions

`ctx.runQuery(api.X.wrapped, …)` and `ctx.runMutation(api.X.wrapped, …)` inherit the calling action's identity. That cuts two ways:

- **Action invoked from an authenticated dashboard route** — identity flows, the wrapped call works.
- **Action invoked from a public/unauthenticated route (tenant checkout, webhooks, schedulers)** — no identity, the wrapped call returns `null` (queries) or throws `UnauthenticatedError` (mutations). The action must route through an internal companion (see pattern below) — the public wrapped function is not accessible without a JWT.

**Rule:** every tenant-facing action that reads or writes wrapped-domain data must call the wrapped function's `…Internal` companion via `internal.X.Y`, not the public `api.X.Y`. The action's own auth model (publicId bearer + chargeability, webhook HMAC, scheduler trust) is the authorization at the entry point; the internal helper just does the data access.

Pattern when wrapping a new domain:

```ts
// convex/{domain}/useCases.ts
export const getById = queryWithAgencyScope({ … });          // staff path
export const getByIdInternal = internalQuery({               // action path
  args: { id: v.id("…") },
  handler: (ctx, { id }) => ctx.db.get(id),
});
```

Audit hook to run whenever wrapping a domain:

```bash
grep -rn 'ctx\.runQuery(api\.<domain>\.' convex/
```

For every hit, walk back to the entry-point action and decide tenant vs staff. Tenant-facing × wrapped requires routing through the internal companion.

## Adoption rule

The dated per-handler migration log was retired (it lives in git history); the legacy `users.getByPublicId` has been removed — use `users.getMe`. New work adopts the wrapper as part of the change; don't add new bare handlers next to existing ones, and remember the internal-companion audit above when you wrap one.

## Admin authorization model

Admin authority is split cleanly between identity and authorization:

- **Auth0 proves identity.** Only `apps/agency` and `apps/admin` use Auth0, and they share the same Auth0 Application (`apps/pay` is publicId-bearer, `apps/fund` is wallet-as-identity). The admin console does not pin an Auth0 Organization; the app-level gate is "signed in, staff row present". A successful login gives you an ID token — nothing more.
- **Convex enforces authorization** via the `mutavStaff` table combined with the staff wrappers in [`convex/lib/auth.ts`](../convex/lib/auth.ts) (`queryWithMutavStaff`, `mutationWithMutavStaff`, `queryWithMutavRole`, `mutationWithMutavRole`). These wrappers verify the caller has a `mutavStaff` row before running the handler and inject `ctx.user` (the resolved `users` row) and `ctx.mutavStaffRoles`; the mutation variants also inject `ctx.appendStaffAudit`. They never inject `ctx.agencyId` and don't combine with the agency wrappers. They do NOT bind to a specific Auth0 Application audience — Convex's identity system does not surface the JWT `aud` claim (see the "Mutav staff wrappers" comment in [`convex/lib/auth.ts`](../convex/lib/auth.ts)). If tighter admin-app provenance is needed later, add a custom claim from an admin Auth0 Post-Login Action (tracked in [#206](https://github.com/mutav-finance/mutav-app/issues/206)). One row per (user, role). No admin capability exists off this table.
- **Identity reads, not capabilities:** [`convex/mutavStaff/useCases.ts`](../convex/mutavStaff/useCases.ts) exports `getMyStaff` (the caller's roles, or `null`; used by the admin staff gate) and `amIStaff` (a boolean; used by the agency destination resolver and shell switcher). Both are `queryWithAuth`, keyed on the caller's `users` row, and grant nothing. The admin gate treats a failed `getMyStaff` read as `unavailable`, never as `not-staff` or `anonymous`.
- **Roles ladder:** `support` < `compliance` < `admin`, checked by `meetsMinRole`. `treasury` is off the ladder (see [`convex/mutavStaff/domain.ts`](../convex/mutavStaff/domain.ts)) — an orthogonal custody capability that never satisfies an operational `minRole` gate.

**Provisioning:** admins grant capabilities through the `/staff` page in `apps/admin/`, which calls `mutavStaff.createStaffRole({ auth0Sub, role })`. The target must have signed in at least once (a `users` row keyed on `subject` must exist) — we never invent user rows from admin input. Each grant writes a `staff.created` entry to the hash-chained audit log. The very first admin (genesis) is granted via the internal-only `bootstrapFirstAdmin` mutation, invoked once per deployment through `bunx convex run mutavStaff:useCases:bootstrapFirstAdmin`; it refuses once any admin row exists and writes a `staff.bootstrap` audit entry attributed to the `system` actor. There is no claim-based auto-provisioning from the JWT — every staff row is either an explicit admin grant or the genesis bootstrap.

**Revocation:** `mutavStaff.deleteStaffRole({ auth0Sub, role })` removes a single row and writes `staff.deleted` to the audit log. It refuses to remove the last remaining `admin` row — whether the caller is removing their own last admin row or mutually revoking another admin's last admin row — because the only recovery from that lockout would be a direct-database write. Revocation must be deliberate: no login path removes a row, and there is no bulk operation.

**Why not Auth0 Organizations?** See the mutavStaff-only decision rationale — no Auth0 Organizations for pilot scope. It's a B2B primitive that forces a Management API integration for basic writes, drags in per-app connection pinning, and only replicates the mutavStaff-row check with more moving parts. The Convex-side gate handles the same "authenticated staff member with the right capability" check with one table, one wrapper family, and one audit trail. When the staff surface grows beyond ~10 people or needs external time-limited access, revisit Auth0 Roles — Organizations were the wrong shape for either bar.

## Reference

- [convex-helpers customFunctions](https://stack.convex.dev/custom-functions) — upstream pattern
- [`convex/lib/auth.ts`](../convex/lib/auth.ts) — implementation
- [`convex/guarantees/useCases.ts`](../convex/guarantees/useCases.ts) — reference consumers
- Issue [#58](https://github.com/mutav-finance/mutav-app/issues/58) — original spec
