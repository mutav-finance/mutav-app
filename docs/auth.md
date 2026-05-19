# Auth — Convex Function Wrappers

> Mutav uses custom Convex function wrappers from [convex-helpers](https://stack.convex.dev/custom-functions) to authenticate and agency-scope every public query and mutation. The wrappers resolve the calling user once, attach `user` / `membership` / `agencyId` to `ctx`, and fail closed on missing identity or membership. Pre-Auth0, identity resolves to a hardcoded `dev-user` row; post-Auth0, swapping one function in `convex/lib/auth.ts` migrates every wrapped handler at once.

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

## Pre-Auth0 dev shortcut

`resolveCurrentUser(ctx)` in `convex/lib/auth.ts` looks up the user by the hardcoded `publicId = "dev-user"`. The same identity the client's `WorkspaceContext` uses. This keeps the wrapper API stable so handlers can be migrated now and Auth0 ships as a one-file change.

The swap point — change exactly this function when Auth0 lands:

```ts
// convex/lib/auth.ts — replace resolveCurrentUser body with:
async function resolveCurrentUser(ctx: DbCtx): Promise<User> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new UnauthenticatedError();
  const user = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .unique();
  if (!user) throw new UnauthenticatedError("User row not provisioned");
  return user;
}
```

That swap also requires:

1. **Schema** — add `subject: v.string()` + `.index("by_subject", ["subject"])` to the `users` table.
2. **Provisioning** — first-login flow that inserts a `users` row keyed on JWT subject (typical place: a `users.upsertFromIdentity` mutation called by a client `useEffect` after sign-in).
3. **`convex/auth.config.ts`** — register the Auth0 provider per [Convex Auth0 docs](https://docs.convex.dev/auth/auth0).
4. **Client** — wrap the app in `<Auth0Provider>` + `<ConvexProviderWithAuth0>`; remove `DEV_USER_PUBLIC_ID` from `src/providers/workspace.tsx` and replace with `useAuth0().user`.

No handler code changes. No wrapper changes. The whole codebase migrates in one PR.

### Multi-entity Auth0 consideration

The three-entity model from [`architecture/entities.md`](architecture/entities.md) (`Mutav-BR` + `Mutav-Fund` + `Mutav-Mgmt`) shows up at Auth0-swap time as a question about Auth0 application / tenant topology:

- **Single Auth0 application, multi-role JWT** (recommended for v1): one Auth0 tenant, one application, JWT carries role claims that map to `mutavStaff` rows scoped per entity via the role's entity tag. A user with `Mutav-BR:compliance` + `Mutav-Mgmt:treasury` holds two `mutavStaff` rows. The wrapper resolution is unchanged; only the provisioning maps Auth0 group → entity-scoped `mutavStaff` row.
- **Separate Auth0 applications per entity** (defer): one Auth0 tenant per legal entity, separate login flows, separate session cookies. Higher friction for cross-entity users (the founders, the v1 ops team); only justified if a regulator demands legal separation of the IDP layer or if the entities split operationally to different teams.

For v1 the single-application option is correct — same operations team serves all three entities, cross-entity roles are normal, and the entity scope lives in the `mutavStaff` row, not in the IDP. Revisit only if entity-level operational separation makes the single-tenant ergonomics painful.

Worth noting in this doc because the Auth0 swap PR is the natural moment to commit to the topology and accidentally choosing wrong creates churn.

## Strict compliance — the rule

**Every public `query` or `mutation` that touches agency-scoped data MUST use a wrapper.** No bare `query({ args, handler })` for new handlers. The two allowed exceptions:

1. **Resource-by-id reads/writes** (the `getByPublicId` pattern) — bare `query`/`mutation` + inline `assertAgencyAccess`. The wrapper can't help because `agencyId` comes from the resource, not args.
2. **`internalMutation` / `internalQuery`** (the `convex/contracts/mutations.ts` pattern) — internal-only writers called via `ctx.runMutation(internal.…)`. Auth was already enforced by the public caller; internals don't re-check.

Everything else: wrapper. PRs that add a bare public `query`/`mutation` for an agency-scoped handler should be rejected at review.

For `ActionCtx` (no `ctx.db`, can't query memberships), use the lower-level `requireIdentity(ctx)` helper for the identity check, and call an `internalQuery` for the membership lookup. Action-level wrappers may be added later; for now actions are rare enough to handle case-by-case.

## Calling wrapped functions from actions

`ctx.runQuery(api.X.wrapped, …)` and `ctx.runMutation(api.X.wrapped, …)` inherit the calling action's identity. That cuts two ways:

- **Action invoked from an authenticated dashboard route** — identity flows, the wrapped call works.
- **Action invoked from a public/unauthenticated route (tenant checkout, webhooks, schedulers)** — no identity, the wrapped call returns `null` (queries) or throws `UnauthenticatedError` (mutations). Pre-Auth0 the `dev-user` fallback masks this; post-Auth0 it surfaces as a silent break.

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
- `convex/anchors/orderUseCases.ts` — `getOrderById`, `listOrdersByPayment` (resource-by-id pattern; + `getOrderByIdInternal` companion for webhook + scheduler pollers)
- `convex/anchors/bankAccountUseCases.ts` — `listByAgency` (+ `listByAgencyInternal` companion for tenant-context onramp actions)
- `convex/anchors/accountUseCases.ts` — `listByAgency`

Removed:

- `convex/contracts/useCases.ts` — `list` (unscoped, leaked all agencies, no client callers)
- `convex/payments/useCases.ts` — `list`, `listByStateKind` (same)

Not yet wrapped (same playbook applies — and remember the internal-companion audit when you do):

- `convex/users/useCases.ts` — `getByPublicId` (load-bearing dev-user lookup for `WorkspaceProvider`)
- `convex/contracts/actions.ts`, `convex/contracts/mutations.ts` — internal-only, lower priority

New work in those domains should adopt the wrapper as part of the change; don't add new bare handlers next to existing bare handlers.

## Reference

- [convex-helpers customFunctions](https://stack.convex.dev/custom-functions) — upstream pattern
- [`convex/lib/auth.ts`](../convex/lib/auth.ts) — implementation
- [`convex/contracts/useCases.ts`](../convex/contracts/useCases.ts) — reference consumers
- Issue [#58](https://github.com/mutav-finance/sgr-app/issues/58) — original spec
