# Auth — Convex Function Wrappers

> Mutav uses custom Convex function wrappers from [convex-helpers](https://stack.convex.dev/custom-functions) to authenticate and agency-scope every public query and mutation. The wrappers resolve the calling user once, attach `user` / `membership` / `agencyId` to `ctx`, and fail closed on missing identity or membership. Identity is JWT-only via Auth0 — there is no dev-user fallback; a deployment without a real `AUTH0_DOMAIN` rejects every authenticated request. See [`src/lib/auth0.ts`](../src/lib/auth0.ts), [`src/providers/convex.tsx`](../src/providers/convex.tsx), and [`convex/auth.config.ts`](../convex/auth.config.ts) for the wiring.

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
// convex/contracts/useCases.ts
import { mutationWithAgencyScope } from "../lib/auth";

export const cancelProposal = mutationWithAgencyScope({
  args: { publicId: v.string() }, // agencyId is supplied by the wrapper
  handler: async (ctx, args) => {
    // ctx.user, ctx.membership, ctx.agencyId are guaranteed
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();

    // NOT_FOUND covers both "no such id" and "exists in another agency"
    if (!contract || contract.agencyId !== ctx.agencyId) {
      return { success: false, error: { code: "NOT_FOUND" } } as const;
    }
    // ...
  },
});
```

```ts
// Client call — still passes agencyId, no change
await cancelProposal({ agencyId: contract.agencyId, publicId: contract.id });
```

## The resource-by-id pattern (`assertAgencyAccess`)

Some routes only know a resource's public id, not its agency — e.g. `/contracts/[publicId]` is deep-linkable and renders server-side via `preloadQuery`. The client has no way to pass `agencyId` along with `publicId` from the URL, so the wrapper can't pre-scope by args.

For these, use a bare `query` + inline `assertAgencyAccess` against the resource's own `agencyId`:

```ts
export const getByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, args) => {
    const contract = await ctx.db
      .query("contracts")
      .withIndex("by_publicId", (q) => q.eq("publicId", args.publicId))
      .unique();
    if (!contract) return null;

    // Returns null on both "no such id" and "not a member of that agency"
    // — never leak cross-agency existence.
    try {
      await assertAgencyAccess(ctx, contract.agencyId);
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

`users.getOrCreateByIdentity` ([`convex/users/useCases.ts`](../convex/users/useCases.ts)) is the idempotent provisioning entry point. Three resolution paths:

1. Existing row with matching `subject` → return.
2. Existing row with matching `email` and no `subject` yet → link by patching the subject (covers users created by older flows before Auth0 was wired).
3. No match → insert.

Identity comes from `ctx.auth.getUserIdentity()` — never from client args. Accepting `subject` from args would let any authenticated user impersonate any other.

Two callsites:

- **Server-side** — the Auth0 `onCallback` hook in [`src/lib/auth0.ts`](../src/lib/auth0.ts) calls it once per successful OAuth callback via `ConvexHttpClient`. This is the canonical first-login path; the row is in place before the user lands on any authenticated route.
- **Client fallback** — [`src/providers/workspace.tsx`](../src/providers/workspace.tsx) watches `getMe` returning `null` despite a valid Auth0 session and fires the mutation as a recovery path. Covers transient `onCallback` failures (Convex offline at login time, network blip) where the user has a valid session but no row.

### `users.getMe` vs. wrapped handlers

`getMe` (bare `query` in [`convex/users/useCases.ts`](../convex/users/useCases.ts)) is the only Convex query that intentionally returns `null` on missing identity or missing row. The UI needs the null to distinguish "loading", "signed out", and "signed in but unprovisioned" — wrapped handlers don't, they fail closed.

| Path                    | Returns                                                  |
| ----------------------- | -------------------------------------------------------- |
| JWT present, row found  | The user row                                             |
| JWT present, no row     | `null` (client provider retries `getOrCreateByIdentity`) |
| JWT absent (signed out) | `null` (UI renders signed-out state)                     |

### Wiring on the client

[`src/providers/convex.tsx`](../src/providers/convex.tsx) decides at build time which Convex provider to render:

- `NEXT_PUBLIC_AUTH0_DOMAIN` set → `<ConvexProviderWithAuth>` + `useAuthFromAuth0` hook that fetches the ID token from `/api/auth/convex-token` (which reads the encrypted session cookie via `auth0.getSession()`).
- Unset → bare `<ConvexProvider>`. The Convex backend sees no JWT; every wrapped handler throws `UnauthenticatedError`.

Both halves are gated on the same env presence, so a mismatched config can't silently downgrade auth.

### Multi-entity Auth0 consideration (deferred to per-entity rollout)

The three-entity model from [`architecture/entities.md`](architecture/entities.md) (`Mutav-BR` + `Mutav-Fund` + `Mutav-Mgmt`) shows up at Auth0-swap time as a question about Auth0 application / tenant topology:

- **Single Auth0 application, multi-role JWT** (recommended for v1): one Auth0 tenant, one application, JWT carries role claims that map to `mutavStaff` rows scoped per entity via the role's entity tag. A user with `Mutav-BR:compliance` + `Mutav-Mgmt:treasury` holds two `mutavStaff` rows. The wrapper resolution is unchanged; only the provisioning maps Auth0 group → entity-scoped `mutavStaff` row.
- **Separate Auth0 applications per entity** (defer): one Auth0 tenant per legal entity, separate login flows, separate session cookies. Higher friction for cross-entity users (the founders, the v1 ops team); only justified if a regulator demands legal separation of the IDP layer or if the entities split operationally to different teams.

For v1 the single-application option is correct — same operations team serves all three entities, cross-entity roles are normal, and the entity scope lives in the `mutavStaff` row, not in the IDP. Revisit only if entity-level operational separation makes the single-tenant ergonomics painful.

Worth noting in this doc because the Auth0 swap PR is the natural moment to commit to the topology and accidentally choosing wrong creates churn.

## Auth0 Organizations — agency identity model

Each **imobiliária maps to one Auth0 Organization**, mirrored 1:1 to one Convex `agencies` row; each **corretor is one Auth0 user** mirrored to one `users` row. **Membership is canonical in Auth0** (the Org's member list + Org role `owner`/`admin`/`member`); the Convex `memberships` row is a **cached projection** synced at login/provisioning. Mutav-internal staff are Auth0 users with **no Organization** + `users.isStaff: true`.

| Concept     | Auth0                 | Convex (projection)        |
| ----------- | --------------------- | -------------------------- |
| Imobiliária | Organization          | `agencies` row             |
| Corretor    | User                  | `users` row                |
| Membership  | Org member + Org role | `memberships` row (cached) |
| Mutav staff | User, no Org          | `users.isStaff: true`      |

**Org naming (no PII).** Auth0 Org `name = ag-<convex agency _id>` (globally unique, stable across renames, carries no PII); `display_name = agencies.name`; `metadata = { cnpj_hmac, agency_type, created_at }`, where `cnpj_hmac` uses the same HMAC pepper as `claimedDocuments` / `hashPii`. Never put the CNPJ or agency name in the Org `name`.

**JWT claim shape.** An Auth0 Post-Login Action injects `https://mutav.com/orgs` = `[{ id, display_name, role }]` (the user's agencies + role). When the user logs in scoped to exactly one Org (`?organization=…`), the native `org_id` claim is also present. **Wrappers prefer the custom `…/orgs` claim and fall back to native `org_id`.**

**Staff identity = Option C (Convex flag), for now.** Staff authority is a `users.isStaff` boolean checked by `queryWithStaff` / `mutationWithStaff`; granted by flipping the flag (no Auth0 change). **Graduate to Auth0 Roles (Option B)** when any of these holds: staff count exceeds ~10; granular per-permission roles are needed (auditor / regional-admin); or an external auditor / compliance officer needs scoped, time-limited access. Estimated 12–18 months out.

**Migration tolerance (no breaking moment).** `queryWithAgencyScope` / `mutationWithAgencyScope` MUST tolerate both shapes during rollout: `agencies.auth0OrgId === undefined` (legacy agency → fall back to the Convex `memberships` projection) and `auth0OrgId === "org_…"` (prefer the JWT Org claim). Schema has landed: `agencies.auth0OrgId` + `by_auth0OrgId` index, `users.isStaff`.

> Decision origin (Option C staff flag + Org-name-no-PII): this section is the durable record (the brainstorm spec was transient and is no longer tracked).

## Strict compliance — the rule

**Every public `query` or `mutation` that touches agency-scoped data MUST use a wrapper.** No bare `query({ args, handler })` for new handlers. The two allowed exceptions:

1. **Resource-by-id reads/writes** (the `getByPublicId` pattern) — bare `query`/`mutation` + inline `assertAgencyAccess`. The wrapper can't help because `agencyId` comes from the resource, not args.
2. **`internalMutation` / `internalQuery`** (the `convex/contracts/mutations.ts` pattern) — internal-only writers called via `ctx.runMutation(internal.…)`. Auth was already enforced by the public caller; internals don't re-check.

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

## Migration status (2026-05-18)

Wrapped:

- `convex/contracts/useCases.ts` — `getByPublicId`, `listByAgency`, `getPipelineSummary`, `countByMonth`, `lookupTenantByCpf`, `create`, `cancelProposal` (+ `getByPublicIdInternal` companion for tenant prefill)
- `convex/payments/useCases.ts` — `listByAgency`, `getById`, `getByPublicId`, `getNextPendingPayment` (+ `getByIdInternal` companion for tenant onramp actions)
- `convex/agencies/useCases.ts` — `getById`, `listAgenciesForUser` (+ `getByIdInternal` companion for internal actions)
- `convex/anchors/orderUseCases.ts` — `getOrderById` (resource-by-id pattern; + `getOrderByIdInternal` companion for webhook + scheduler pollers)
- `convex/anchors/bankAccountUseCases.ts` — `listByAgency` (+ `listByAgencyInternal` companion for tenant-context onramp actions)

Removed:

- `convex/contracts/useCases.ts` — `list` (unscoped, leaked all agencies, no client callers)
- `convex/payments/useCases.ts` — `list`, `listByStateKind` (same)
- `convex/anchors/orderUseCases.ts` — `listOrdersByPayment` (no client callers; resurrect via git history if a UI consumer lands)
- `convex/anchors/accountUseCases.ts` — `listByAgency` (no client callers; admin cross-agency access lands via #87 staff wrappers, not by reintroducing this query)

Not yet wrapped (same playbook applies — and remember the internal-companion audit when you do):

- `convex/users/useCases.ts` — `getByPublicId` retained for legacy callers; new code should call `getMe`. Removable when no callers reference it.
- `convex/contracts/actions.ts`, `convex/contracts/mutations.ts` — internal-only, lower priority

New work in those domains should adopt the wrapper as part of the change; don't add new bare handlers next to existing bare handlers.

## Reference

- [convex-helpers customFunctions](https://stack.convex.dev/custom-functions) — upstream pattern
- [`convex/lib/auth.ts`](../convex/lib/auth.ts) — implementation
- [`convex/contracts/useCases.ts`](../convex/contracts/useCases.ts) — reference consumers
- Issue [#58](https://github.com/mutav-finance/sgr-app/issues/58) — original spec
