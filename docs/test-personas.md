# Test personas

Pre-provisioned Auth0 accounts for testing each Mutav user state without going through the full onboarding flow.

> [!WARNING]
> **Dev tenant only.** These credentials only work on the shared dev tenant `dev-ay46ib0hhi1mdwpw.us.auth0.com`, which currently serves localhost, every Vercel preview, and `https://mutav-app.vercel.app`. They will be **invalidated** when the separate `mutav-prod` Auth0 tenant gets cut (tracked in #119). Do **not** rely on them for production validation, and do **not** use this password anywhere else.

## Credentials

All four personas share the password **`MutavDev2026!`**.

| Persona                       | Email                       | Auth0 subject                     | Convex seeded state              | Expected landing on login                                                        |
| ----------------------------- | --------------------------- | --------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| **System admin (Mutav team)** | `systemadmin@mutav.finance` | `auth0\|6a150df6a100fbf318f393c0` | `users.isStaff: true`, no agency | `/onboarding` today — gap: no `(admin)` shell yet (tracked in #121 cascade PR-6) |
| **Agency owner**              | `agencyowner@mutav.finance` | `auth0\|6a150df7def07da7a5297480` | active agency                    | `/` (dashboard)                                                                  |
| **Pending user**              | `pendinguser@mutav.finance` | `auth0\|6a150df8d2051b0ac866a3b6` | under_review agency              | `/onboarding/status?state=under_review`                                          |
| **New user**                  | `newuser@mutav.finance`     | `auth0\|6a150df9a100fbf318f393c3` | none                             | `/onboarding`                                                                    |

All four are marked `email_verified: true` on Auth0 — no verification step on first login.

### How `isStaff` is set

The `seedTestPersonas` mutation patches `users.isStaff: true` onto the systemadmin row at seed time. The `PERSONAS` map in `convex/seed.ts` is the source of truth for who gets the flag — currently only `systemadmin`. To grant staff to additional users post-seed, flip `isStaff: true` via the Convex dashboard on their `users` row.

Staff identity isn't enforced anywhere yet — the `(admin)` route group + `queryWithStaff`/`mutationWithStaff` wrappers ship in PR-6 of the Auth0 Orgs cascade.

## How the seeded state attaches to the Auth0 user

`convex/seed.ts:seedTestPersonas` writes the Convex `users` row with the Auth0 `subject` **baked in** — the binding is explicit, not derivative. No email-link dance on first login. The persona-to-subject map lives in the `PERSONAS` constant in `convex/seed.ts` and must stay in sync with this doc and the Auth0 tenant; updating the dev tenant means updating both.

## Recreating the personas on a fresh Convex deployment

Each preview deployment gets its own Convex DB (5-day auto-cleanup). For Vercel previews this is automatic — `scripts/seed-preview.sh` calls `seed:seedPreview` after every deploy, which wipes the DB and re-seeds the fictional dataset plus all four personas.

For local dev or manual reset, two commands give you each axis of the seed:

| Goal                                                           | Command                                 |
| -------------------------------------------------------------- | --------------------------------------- |
| Full reset (wipe + fictional dataset + personas)               | `bunx convex run seed:seedPreview`      |
| Refresh only the personas (idempotent, leaves everything else) | `bunx convex run seed:seedTestPersonas` |

`seedTestPersonas` skips personas whose state already matches, so it's safe to re-run. The Auth0 side (account + password) doesn't need recreating — it's tenant-scoped, not deployment-scoped.

## Recreating the personas on a fresh Auth0 tenant

Useful when the prod tenant is cut. From a checkout with the CLI logged in to the new tenant:

```bash
for email in systemadmin agencyowner pendinguser newuser; do
  auth0 api post users --data "$(cat <<EOF
{
  "email": "${email}@mutav.finance",
  "password": "MutavDev2026!",
  "connection": "Username-Password-Authentication",
  "name": "${email}",
  "email_verified": true
}
EOF
)"
done
```

The new tenant will issue different `user_id` values for each persona. **Update the `PERSONAS` constant in `convex/seed.ts`** with the new subjects (and this table), then run `bunx convex run seed:seedTestPersonas` against the matching Convex deployment.

## Multi-persona testing in one browser

Open one of:

- Chrome → File → New Profile (one per persona)
- Chrome → File → New Incognito Window (cookies isolated, but only one incognito session)
- Different browsers (Chrome / Safari / Firefox)

Auth0 sessions are tied to cookies on `https://dev-ay46ib0hhi1mdwpw.us.auth0.com`, so any tab sharing that cookie jar shares the session.

## Rotation procedure

If a password leaks (it shouldn't — it's already in the repo and on the dev tenant only):

```bash
for uid in 6a150df6a100fbf318f393c0 6a150df7def07da7a5297480 6a150df8d2051b0ac866a3b6 6a150df9a100fbf318f393c3; do
  auth0 api patch "users/auth0|${uid}" --data '{"password":"NewPassword!","connection":"Username-Password-Authentication"}'
done
```

Then update the password in this file.

## Related

- #117 — Auth0 wiring + dev-user fallback drop
- #119 — pre-launch hardening (rotates this when prod tenant is cut)
- `convex/seed.ts` — the `seedPersonaAgency` helper + three state mutations
- `src/lib/user-destination.ts` — the routing helper that interprets each persona's state into a landing URL
