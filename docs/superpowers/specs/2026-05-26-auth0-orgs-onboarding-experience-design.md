# Auth0 Organizations — Integrated Onboarding Experience

**Status:** Approved design, ready for implementation plan
**Owners:** Auth0 wiring (#117 already merged-pending), Orgs migration (#121), GC (#122)
**Last decision date:** 2026-05-26

## Purpose

Define how Auth0 Organizations integrates into Mutav's existing imobiliária onboarding flow, replacing Convex memberships as the canonical source for "which user belongs to which agency" while keeping the user experience identical to today.

## Mental model

The **imobiliária is the customer**. The corretor is a user of an imobiliária. This is the Slack/Linear model — the workspace is the long-lived paying entity, users belong to it.

| Concept | Realized as |
|---|---|
| Imobiliária | One Auth0 Organization + one Convex `agencies` row |
| Corretor | One Auth0 user + one Convex `users` row |
| Membership (corretor in imobiliária) | Auth0 Org member (canonical) + Convex `memberships` row (cached projection) |
| Role within imobiliária | Auth0 Org role (`owner` / `admin` / `member`) + mirrored in Convex membership |
| Mutav team member | Auth0 user with **no Org** + Convex `users.isStaff: true` flag |

The user never sees the word "organization" in the UI. All copy stays "imobiliária", "minha empresa", "espaço de trabalho".

## End-to-end user flow

```
[Anonymous visitor]
   ↓
Marketing landing → "Cadastre sua imobiliária" CTA
   ↓
/auth/login  (Auth0 Universal Login: email+password or Google OAuth)
   ↓
Sign up (or log in) → onCallback fires
   → users.getOrCreateByIdentity provisions Convex user row
   → no Auth0 Org membership yet (organization_usage = allow)
   ↓
Redirect to /
   ↓
(app) layout guard → resolveUserDestination
   → no memberships → /onboarding
   ↓
WelcomeScreen — pick autonomo / empresa
   ↓
/onboarding/agency?type=X
   ↓
STEP 1 (Profile) — collect name, contact email, phone, CRECI, CPF or CNPJ
   ↓
   SUBMIT → startOnboarding (mutation, sync)
      1. Insert agency (state=in_progress, auth0OrgId=null)
      2. Insert membership (user=OWNER) in Convex
      3. scheduler.runAfter(0, provisionAuth0Org, { agencyId })
   ↓
   Wizard advances immediately to Step 2 (no waiting on Auth0)
   ↓
   (background) provisionAuth0Org action:
      → POST /organizations { name: ag-<convex_id>, display_name: agency.name }
      → POST /organizations/{orgId}/members { members: [user.subject] }
      → POST /organizations/{orgId}/enabled_connections { Username-Password-Authentication, google-oauth2 }
      → patch agencies.auth0OrgId = orgId
   ↓
STEP 2 (Banking) — saveBankingInfo — unchanged
   ↓
STEP 3 (empresa only — Documents) — saveDocument — unchanged
   ↓
STEP N (Review) — submitOnboarding — transitions in_progress → submitted
   ↓
/onboarding/status — waiting for Mutav approval
   ↓
[Mutav staff approval via (admin) panel — separate concern]
   → state=active → /  (dashboard with agency-scoped data)
   → state=rejected → /onboarding/rejected
   ↓
Subsequent logins
   → Auth0 Post-Login Action injects custom claim:
     https://mutav.com/orgs = [{id, display_name, role}, ...]
   → JWT carries the full org list
   → Convex wrappers prefer JWT-derived membership; fall back to Convex `memberships`
   ↓
WorkspaceContext picks "currently selected" agency client-side (today's UX preserved)
```

## Auth0 tenant configuration

| Setting | Value | Why |
|---|---|---|
| `organization_usage` | `allow` | `require` chicken-and-eggs signup — new users with no org couldn't log in to start onboarding |
| `organization_require_behavior` | `no_prompt` | Irrelevant in allow mode |
| Enabled connections on each provisioned Org | `Username-Password-Authentication`, `google-oauth2` | So users can authenticate when logging in via org context |
| Default org for unaffiliated users | none | They go through onboarding; they're not "in" any org until Step 1 of wizard |

## Org provisioning timing — robustness

`startOnboarding` becomes a Convex **mutation** (Convex-only, synchronous) that **schedules** a background **action** for the Auth0 HTTP work. The user is never blocked on Auth0 latency.

### Failure modes and handling

| Failure | Behavior |
|---|---|
| Auth0 transient 5xx / timeout | Background action retries with exponential backoff (Convex `scheduler.runAfter`, or `@convex-dev/workpool` once adopted) |
| Auth0 permanent failure (config error) | Log to `failedOrgProvisioning` table; surface in admin panel; Mutav staff intervenes |
| User submits final step before Org is provisioned | Allow submission. `submitted` state doesn't depend on `auth0OrgId`. Provisioning continues async. Admin sees a flag at review time if Org still missing. |
| Convex agency deleted (GC #122) before Org provisioned | Background action checks agency exists at start; aborts if not |
| Org provisioned but Convex agency later deleted | GC job (#122) deletes the Org via `DELETE /organizations/{id}` — idempotent on 404 |

### Wrapper compatibility during migration

`queryWithAgencyScope` / `mutationWithAgencyScope` MUST tolerate BOTH shapes:

- `agency.auth0OrgId === undefined` (legacy or not-yet-provisioned) → fall back to Convex membership lookup (status quo behavior)
- `agency.auth0OrgId === "org_xxx"` → prefer JWT `org_id` / `https://mutav.com/orgs` claim from Auth0 Action

This means there's no breaking moment. Existing in_progress agencies that haven't been provisioned yet keep working through the wizard.

## Org name + identifier scheme

| Auth0 field | Value | Reasoning |
|---|---|---|
| `name` (unique slug, 1-50 chars) | `ag-<convex_agency_id>` (e.g. `ag-j5792vaywkj0ns4yn9vxgp08yx87f9mm`) | Globally unique by construction. No PII. Stable across agency renames. Easy reverse-lookup from Convex. |
| `display_name` | `agencies.name` (the imobiliária's friendly name) | Editable. Re-synced via webhook when `agencies.name` changes. |
| `branding.colors.primary` | Mutav brand accent (eventually per-agency) | Currently global; per-agency branding deferred until customer asks (Phase 3 of #121) |
| `metadata` | `{ cnpj_hmac, agency_type, created_at }` | HMAC of CNPJ (not raw — same hashing as `claimedDocuments`); enough for ops to find the matching Convex agency without exposing PII in Auth0 dashboard. |

## JWT claim shape (Auth0 Post-Login Action)

The Auth0 Action injects a custom claim with the user's full org membership so the in-app workspace switcher works without re-auth:

```json
{
  "sub": "auth0|6a150df7def07da7a5297480",
  "iss": "https://dev-ay46ib0hhi1mdwpw.us.auth0.com/",
  "aud": "ebTgI118etRhCRUGvtsueh8FJdUempw1",
  "email": "agencyowner@mutav.finance",
  "https://mutav.com/orgs": [
    {
      "id": "org_jFlydvjHNHVRMH2V",
      "display_name": "Imobiliária Paulista",
      "role": "owner"
    },
    {
      "id": "org_aB7xyz...",
      "display_name": "Imobiliária Atlântica",
      "role": "member"
    }
  ]
}
```

If the user is in exactly one org AND logged in via `?organization=`, Auth0 also includes the native `org_id` claim. Our wrappers handle both: prefer the custom claim (richer, handles multi-org), fall back to native `org_id`.

## Mutav staff identity (Option C: Convex flag)

Decided to use a Convex-side `users.isStaff` boolean rather than Auth0 Orgs or Roles.

| | Value |
|---|---|
| Schema | `users.isStaff: v.optional(v.boolean())` — defaults absent/false |
| Wrappers | `queryWithStaff` / `mutationWithStaff` in `convex/lib/auth.ts` — throws if `!ctx.user.isStaff` |
| `resolveUserDestination` | New branch: if `currentUser.isStaff && agencies.length === 0` → return `{ kind: "staff-dashboard" }` |
| Future `(admin)` route group | Uses the staff wrappers; renders cross-agency surfaces (approval queue, NAV updates, audit log review, KYC) |
| How to grant | Flip `isStaff: true` via Convex dashboard. No Auth0 changes needed. |
| Test persona | `systemadmin@mutav.finance` already exists; the `seedTestPersonas` mutation patches `isStaff: true` onto it after this design lands |

### When to graduate to Auth0 Roles (Option B)

Graduate when ANY of:
- Staff count exceeds ~10
- Granular permissions needed (`auditor` can read but not approve, `regional-admin` only sees São Paulo agencies)
- External auditor / compliance officer needs scoped, time-limited access

Estimated 12-18 months out. Not blocking pre-launch.

## Adoption order — cascading PRs

Each step is independently shippable + reviewable. Cascade only merges to main after the full chain is verified end-to-end.

| # | Branch | Scope |
|---|---|---|
| 1 | `feat/auth-wire-auth0` (#117, already done) | Auth0 wired, dev-user fallback dropped, layout guard, personas |
| 2 | `feat/auth0-orgs-schema` (this branch) | `agencies.auth0OrgId` + `by_auth0OrgId` index; `users.isStaff` + helpers |
| 3 | `feat/auth0-orgs-mgmt-api` | `convex/lib/auth0Mgmt.ts` action helper with cached M2M token; Auth0 M2M app provisioned in dashboard; env vars added |
| 4 | `feat/auth0-orgs-provision` | `provisionAuth0Org` background action; `startOnboarding` schedules it; `failedOrgProvisioning` table for permanent failures |
| 5 | `feat/auth0-orgs-jwt-claim` | Auth0 Post-Login Action injects `https://mutav.com/orgs`; wrappers prefer JWT claim, fall back to Convex memberships |
| 6 | `feat/auth0-orgs-staff-shell` | `(admin)` route group; `queryWithStaff`/`mutationWithStaff` wrappers; approval queue UI |
| 7 | `feat/auth0-orgs-invite-ui` | "Invitar corretor" surface in (app); POSTs to `/organizations/{id}/invitations`; webhook syncs to Convex on accept |
| 8 | `feat/auth0-orgs-gc` (#122) | Cron-scheduled action that deletes abandoned in_progress agencies + their orphan Orgs |

## Non-goals (explicit out-of-scope for this design)

- Per-org branded login (Auth0 paid tier feature, deferred until customer demand — Phase 3 of #121)
- Per-org SAML / Google Workspace SSO (deferred until first enterprise customer asks)
- Cross-org admin permissions beyond `isStaff: true` (deferred until staff count justifies it)
- Backfilling Auth0 Orgs for legacy agencies (none exist pre-launch; design assumes greenfield)
- Marketing landing page (separate concern; assumed to exist or be built independently)
- Approval UI for Mutav staff (referenced as separate concern; not designed here)
- Investor portal (different identity model entirely — per-chain wallet)

## Open questions for implementation phase

1. **`@convex-dev/workpool` adoption** — this design uses Convex's native `scheduler.runAfter` for retries; workpool would give cleaner retry policy + concurrency control. Trigger to adopt: when a second background workflow shows up (likely the GC job in #122).
2. **`failedOrgProvisioning` surface** — UI placement (admin shell? per-agency detail page?). Defer to admin-shell PR (#6).
3. **Webhook configuration** — Auth0 → Convex webhook for org-member-added/removed events. Needs an HTTP endpoint in Convex (`convex/http.ts`). PR #7 will introduce.
4. **Test personas adjustment** — `systemadmin@mutav.finance` already exists; the `seedTestPersonas` mutation needs `isStaff: true` patch added in PR #2 (this branch).

## Pre-launch hardening dependencies (#119)

- The full migration runs against the SHARED `dev-ay46ib0hhi1mdwpw` tenant initially. Personas, test orgs, and operational data created during development persist there.
- When `mutav-prod` tenant is provisioned (#119), the migration's PRs #3-#7 need to be re-validated against the new tenant: new M2M app, new Action, new connections enabled per org.
- Org IDs (`org_xxx`) are tenant-scoped. Production agencies will have different `auth0OrgId` values than dev — no data carryover from dev tenant.

## References

- #117 — Auth0 wiring + dev-user fallback drop (foundation; merged-pending)
- #119 — pre-launch hardening (separate prod tenant)
- #121 — Auth0 Orgs migration tracking (parent; this design supersedes the phase-based sketch there)
- #122 — abandoned-orgs GC (depends on this design)
- `docs/test-personas.md` — current dev personas
- `docs/architecture/admin.md` — `mutavStaff` actor + `(admin)` shell (referenced by staff design)
- `docs/architecture/reliability.md` — workflow durability patterns (referenced by timing/robustness)
- `convex/lib/auth.ts` — existing wrappers to be extended
- `src/lib/user-destination.ts` — routing helper to be extended with `staff-dashboard` branch
