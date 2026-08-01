# Navigation & shell audit

Inventory of every route, every piece of chrome, and every place the two disagree — written to surface the decisions needed before building authenticated / unauthenticated shell variants.

**This document decides nothing.** It maps what exists and lists what must be decided. Status as of `main` @ `e57b327`.

Reconciles against [§ Shell catalog](README.md#shell-catalog), which describes the intended organization. Where reality has drifted, this document records reality.

## 1. Route map

31 routes across 4 apps. "Chrome" is what the user actually sees around the page content.

### `apps/agency` — `app.mutav.finance` (13 routes)

| Route                  | Group          | Chrome                                         | Auth                      |
| ---------------------- | -------------- | ---------------------------------------------- | ------------------------- |
| `/`                    | `(app)`        | `AppSidebar` + `SiteHeader`                    | Auth0 + agency membership |
| `/contracts`           | `(app)`        | same                                           | same                      |
| `/contracts/new`       | `(app)`        | same                                           | same                      |
| `/contracts/[id]`      | `(app)`        | same                                           | same                      |
| `/invoices`            | `(app)`        | same                                           | same                      |
| `/invoices/[id]`       | `(app)`        | same                                           | same                      |
| `/commission`          | `(app)`        | same                                           | same                      |
| `/delinquencies`       | `(app)`        | same                                           | same                      |
| `/transparency`        | `(app)`        | same                                           | same                      |
| `/onboarding`          | `(onboarding)` | `PublicShell` + inline header + `PublicFooter` | Auth0, **no** agency yet  |
| `/onboarding/agency`   | `(onboarding)` | same                                           | same                      |
| `/onboarding/status`   | `(onboarding)` | same                                           | same                      |
| `/onboarding/rejected` | `(onboarding)` | same                                           | same                      |

### `apps/pay` — `pay.mutav.finance` (5 routes)

| Route                        | Chrome                          | Auth                     |
| ---------------------------- | ------------------------------- | ------------------------ |
| `/pay/[publicId]`            | `PublicHeader` + `PublicFooter` | None — `publicId` bearer |
| `/pay/[publicId]/pix`        | same                            | same                     |
| `/pay/[publicId]/stellar`    | same                            | same                     |
| `/pay/[publicId]/paid`       | same                            | same                     |
| `/pay/[publicId]/anchortest` | same                            | same                     |

### `apps/fund` — `fund.mutav.finance` (4 routes)

| Route                    | Chrome        | Auth                                      |
| ------------------------ | ------------- | ----------------------------------------- |
| `/investor`              | `InvestorNav` | None enforced — wallet button is disabled |
| `/investor/deposit`      | same          | same                                      |
| `/investor/redeem`       | same          | same                                      |
| `/investor/transparency` | same          | same                                      |

### `apps/admin` — `admin.mutav.finance` (9 routes)

| Route                                                                              | Group     | Chrome                      | Auth                     |
| ---------------------------------------------------------------------------------- | --------- | --------------------------- | ------------------------ |
| `/`                                                                                | `(admin)` | `AppSidebar` + `SiteHeader` | Auth0 + `mutavStaff` row |
| `/agencies` `/compliance` `/defaults` `/nav` `/observability` `/staff` `/treasury` | `(admin)` | same                        | same                     |
| `/access-denied`                                                                   | —         | **none** (root layout only) | publicly reachable       |

## 2. Chrome inventory

Six distinct chrome configurations. None is shared between apps.

| #   | Configuration                        | Where                           | Auth-aware?            |
| --- | ------------------------------------ | ------------------------------- | ---------------------- |
| 1   | Sidebar + header                     | `agency/(app)`                  | no                     |
| 2   | Sidebar + header                     | `admin/(admin)`                 | no                     |
| 3   | PublicShell + inline header + footer | `agency/(onboarding)`           | **yes** — the only one |
| 4   | PublicHeader + footer                | `pay/[publicId]`                | no                     |
| 5   | Top nav bar                          | `fund/(investor)`               | no                     |
| 6   | No chrome                            | `admin/access-denied`, all 404s | n/a                    |

### Component ownership

| Component                                                          | Location                   | Shared?                                      |
| ------------------------------------------------------------------ | -------------------------- | -------------------------------------------- |
| `AppSidebar`                                                       | `agency/` **and** `admin/` | duplicated, 53 vs 79 lines                   |
| `SiteHeader`                                                       | `agency/` **and** `admin/` | duplicated, 17 vs 35 lines                   |
| `NavMain`                                                          | `agency/` **and** `admin/` | duplicated                                   |
| `NavAgency`, `NavCadastros`, `ShellSwitcher`, `SidebarRoadmapItem` | `agency/` only             | app-local                                    |
| `InvestorNav`                                                      | `fund/` only               | app-local                                    |
| `PublicHeader`                                                     | `pay/` only                | app-local                                    |
| `NavUser`, `sidebar`, `PublicShell`, `PublicFooter`                | `@mutav/ui`                | shared primitives — but no shell composition |

`@mutav/ui` ships the _pieces_ (sidebar primitive, nav-user, public shell, footer). It ships no _shell_. Every app composes its own.

## 3. Findings

**F1 — Only one auth-aware chrome exists, and it is inline.** `agency/(onboarding)/onboarding/layout.tsx` branches on `auth0.getSession()` to show a log-out link. It is hand-written in the layout, carries an `eslint-disable` for the raw `<a>`, and is the sole precedent for the pattern this work generalizes.

**F2 — The decision is already documented as deferred.** `pay/[publicId]/layout.tsx` says: "V1 uses PublicHeader/Footer for both agency-authed and renter-public viewers; auth-aware chrome swap (sidebar vs public) is deferred until Auth0 lands." Auth0 has since landed. The deferral is now due.

**F3 — No app has a `not-found.tsx`.** Every 404 across all four apps renders Next's default page with no chrome, no brand, no way back. This is the largest unstyled surface in the product.

**F4 — Agency and admin duplicate three components each.** `AppSidebar`, `SiteHeader`, and `NavMain` exist twice with divergent implementations. Admin's `SiteHeader` has since gained a wallet connect button and a back-to-agency link that agency's lacks.

**F5 — The wordmark is implemented three times inline.** `fund/InvestorNav`, `agency/(onboarding)` layout, and `pay/PublicHeader` each hand-roll an amber square + "MUTAV" lockup with different markup, sizes, and `aria-label`s. None lives in `@mutav/ui`, and `brand/` is the canonical source per workspace CLAUDE.md.

**F6 — `fund`'s nav is not internationalized.** `InvestorNav` hardcodes English `"Dashboard"`, `"Deposit"`, `"Redeem"`, `"Transparency"`, and `"Connect Wallet"` while `pt-BR` is the default locale. Every other nav uses `useTranslations`.

**F7 — `fund` has no auth state at all.** Its Connect Wallet button is `disabled`. There is no connected/disconnected variant to switch between yet.

**F8 — There is no login screen to style.** Auth0 Universal Login is hosted by Auth0, outside this codebase. An "unauthenticated variant" cannot cover sign-in unless Universal Login is separately branded in the Auth0 dashboard.

## 4. Decisions needed

Ordered by how much downstream work each unblocks.

### D1 — How many shell variants are there?

The request names two (authenticated / unauthenticated) and hypothesizes a third (user-flow / full-bleed). The route map supports **three**, but the boundary is not obvious:

- **App** — persistent nav, sidebar or top bar, user menu. `agency/(app)`, `admin/(admin)`, `fund/(investor)`.
- **Flow** — minimal chrome, no nav, brand + escape hatch only. `agency/(onboarding)`, `pay/[publicId]`.
- **Bare** — brand + a single action, no chrome. `access-denied`, 404s.

Is Bare its own variant or just Flow with no steps? Is `fund/(investor)` App, given it has no user menu and no auth?

### D2 — Is the variant chosen by auth state, or by route?

These are not the same axis, and F1/F2 conflate them:

- `agency/(onboarding)` is authenticated but deliberately has no app nav.
- `pay/[publicId]` may be viewed by an authenticated agency user _or_ an anonymous tenant, at the same URL.

If the variant is a property of the route group, auth state only drives _slots inside_ the chrome (user menu vs sign-in link). If the variant is a property of auth state, `pay` needs to swap shells per viewer — which is exactly what F2 deferred. **Recommend: route decides the shell, auth decides the slots.** Needs confirmation because everything downstream depends on it.

### D3 — Does the shell move to `@mutav/ui`, and how much?

Three options, materially different in cost:

1. **Primitives only** (status quo) — each app composes. Duplication in F4 stays.
2. **Shared shell components** — `<AppShell>`, `<FlowShell>`, `<BareShell>` in `@mutav/ui`, each app passes nav items and identity as props. Resolves F4, F5.
3. **Shared shell + shared nav config** — also centralizes nav item definitions. Risks coupling apps that should stay independent per the origin-isolation ADR.

`packages/*` must not read env or auth (CLAUDE.md), so identity has to arrive as props regardless.

### D4 — What does the unauthenticated variant actually show?

Sign in? Nothing? Brand only? This differs per app: `pay` must never show a sign-in affordance (F8, and the app deliberately carries no Auth0 SDK to limit phishing surface), while `fund` will need a wallet connect.

### D5 — Do 404s get a shell? (F3)

The cheapest large win here, and it needs D1 settled first. Also: does a 404 inside `(app)` keep the sidebar, or drop to Bare?

### D6 — Does `fund` get internationalized as part of this? (F6)

It is the only nav with hardcoded strings. Doing it inside this work is cheap; doing it separately means touching the same file twice.

### D7 — Is Auth0 Universal Login branded? (F8)

Out of scope for a shell refactor, but it is the first screen an unauthenticated user sees. If it stays default-Auth0, the "unauthenticated experience" is inconsistent no matter what is built here.

## 5. Not investigated

- Mobile / responsive behavior of any nav — reviewed as source, not rendered at breakpoints.
- `apps/agency`'s `SidebarRoadmapItem` and `NavCadastros`, whose purpose was not established.
- Whether `fund`'s "scroll-with-document" root layout comment matches its `h-svh overflow-hidden` markup — they appear to contradict.
