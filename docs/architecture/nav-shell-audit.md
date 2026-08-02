# Navigation & shell audit

Inventory of every route, every piece of chrome, and every place the two disagree — written to surface the decisions needed before building authenticated / unauthenticated shell variants.

Sections 1–3 are the inventory. Section 4 records the decisions taken from it (2026-08-01); section 5 is the work that follows. Status as of `main` @ `e57b327`.

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

## 4. Decisions

Settled 2026-08-01. D7 remains open and is out of scope for the shell work.

### D1 — Three shell variants ✅

| Variant  | Chrome                                              | Routes                                             |
| -------- | --------------------------------------------------- | -------------------------------------------------- |
| **App**  | persistent nav (sidebar or top bar) + identity slot | `agency/(app)`, `admin/(admin)`, `fund/(investor)` |
| **Flow** | brand + escape hatch, no nav                        | `agency/(onboarding)`, `pay/[publicId]`            |
| **Bare** | brand + a single action                             | `admin/access-denied`, every 404                   |

Bare stays distinct from Flow: collapsing them would give `access-denied` and 404s chrome built for multi-step flows.

### D2 — Route picks the shell; auth picks the slots ✅

The route group determines which shell renders. Auth state only swaps what fills the **identity slot** (user menu / sign-in link / nothing).

This resolves F2 without the swap it deferred: `pay/[publicId]` renders `FlowShell` for every viewer, authenticated or not, and varies only the slot. One layout, one shell, no request-time shell selection and no layout shift.

### D3 — Three shells in `@mutav/ui`, nav passed as props ✅

`<AppShell>`, `<FlowShell>`, `<BareShell>` live in `@mutav/ui`. Each app passes its own nav items, identity slot, and brand. Resolves F4 (duplicated `AppSidebar` / `SiteHeader` / `NavMain`) and F5 (three inline wordmarks — the lockup becomes one component).

Nav item **definitions** stay app-local. Centralizing them would couple apps the origin-isolation ADR ([0003](decisions/0003-persona-app-origin-isolation-single-convex.md)) deliberately keeps independent.

`packages/*` must not read env or auth (CLAUDE.md), so identity arrives as props regardless.

### D4 — `pay`'s identity slot stays empty for everyone ✅

Identical chrome for authenticated agency users and anonymous tenants. `apps/pay` carries **no Auth0 SDK** by design — it limits phishing surface and the blast radius of a future Auth0 vulnerability (see [§ App catalog](README.md#app-catalog)). Reading session state there would mean adding the SDK back, reversing that decision for a convenience affordance.

`fund`'s slot takes the wallet connect button; `agency` and `admin` take the user menu.

### D5 — 404s get the Bare shell ✅

Follows from D1. Every app gains a `not-found.tsx`. A 404 inside `(app)` drops to Bare rather than keeping the sidebar — the route did not resolve, so the nav has nothing valid to reflect.

### D6 — `fund`'s nav is internationalized in the same change ✅

`InvestorNav` is rewritten for the shell migration anyway; doing F6 separately means touching one file twice.

### D7 — Auth0 Universal Login branding — OPEN

Out of scope for the shell work, but it is the first screen an unauthenticated user sees. While it stays default-Auth0, the unauthenticated experience is inconsistent regardless of what ships here. Track separately.

## 5. Scope that follows — shipped

1. ✅ `<AppShell>` / `<FlowShell>` / `<BareShell>` + a `Wordmark` component in `@mutav/ui`.
2. ✅ Migrate the chrome configurations onto them; delete the agency/admin duplicates.
3. ✅ `not-found.tsx` in all four apps (Bare).
4. ✅ Replace the inline auth-aware header in `agency/(onboarding)` with a Flow identity slot.
5. ✅ i18n `InvestorNav`; wire its wallet button as `fund`'s identity slot.
6. ✅ Enforcement — see § 8.

Two rulings taken during implementation, recorded so they are not re-opened by omission:

- **`fund/(investor)` did not adopt `<AppShell>`.** D1 lists it under the App variant, but its arrangement is a top bar and serving both from one component would need either a boolean flag (forbidden by CLAUDE.md) or a `navPlacement` enum that drags `SidebarProvider`'s cookie/keyboard/CSS-var machinery into a sidebar-less app. § 6's unresolved contradictions sit under fund and none is test-covered. Deferred to § 7; `fund` still got D5, D6, and a real identity slot.
- **`pay`'s skip link now targets `#main-content`, not `#primary-action`.** The deleted `pay/[publicId]/layout.tsx` pointed a link labelled "skip to main content" at the payment CTA. `FlowShell` owns `<main id="main-content">`, so the label and the target now agree; the two orphaned `id="primary-action"` anchors were removed with it. A screen-reader user lands on the step's content rather than mid-panel.
- **`<BareShell>` mounts no `ThemeProvider`.** `admin/access-denied` renders outside any `ThemeProvider` today (only the `(admin)` group layout mounts one), so next-themes never stamps `<html>` for that route. Adding one would change the rendered output for system-dark viewers; the shell ships the existing inconsistency deliberately so the migration had zero rendered diff.

Also settled: no root-level `apps/*/src/app/not-found.tsx`. All four proxies rewrite everything into `[locale]` (matcher `/((?!_next/static|_next/image|_vercel|.*\..*).*)`), so an unmatched path reaches `[locale]/not-found.tsx`. Only dotted paths bypass the middleware and fall to Next's built-in fallback — accepted, rather than papered over with a `not-found.tsx` that would render with no `<html>`/`<body>` wrapper.

## 6. Not investigated

- Mobile / responsive behavior of any nav — reviewed as source, not rendered at breakpoints.
- `apps/agency`'s `SidebarRoadmapItem` and `NavCadastros`, whose purpose was not established.
- Whether `fund`'s "scroll-with-document" root layout comment matches its `h-svh overflow-hidden` markup — they appear to contradict. `(investor)/layout.tsx` re-introduces `overflow-y-auto` on an inner div.

## 7. Follow-ups

**`fund/(investor)` adopts the App shell.** Gated on § 6's scroll-ownership question being resolved first, plus two things that make a shared shell unsafe today: the investor palette comes from a literal `dark` class on the `(investor)` div rather than next-themes (a shell owning that element would flip the portal to light in a way invisible in code review), and `fund` mounts no `ThemeProvider`, `Toaster`, or `TooltipProvider`.

Until then the layout is an explicit exemption in `tests/shell-contract.test.ts` (`SHELL_EXEMPT_LAYOUTS`) — an exemption with a tracking reference, not a softened check. The test also asserts the exempt path still exists, so a stale entry fails rather than silently disabling the assertion. Deleting the entry is the last step of the follow-up.

D7 (Auth0 Universal Login branding) also remains open — see § 4.

## 8. Enforcement

Three mechanisms, three moments. None of them can tell an author _which_ shell a new route wants — that is what § 4's table and [`../../CLAUDE.md` § "Which shell a new route gets"](../../CLAUDE.md#which-shell-a-new-route-gets) are for.

| Gate                                                      | Fires at      | Catches                                                                                                                                                                                                                 |
| --------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/shell-contract.test.ts` (`bun run test:structure`) | merge (CI)    | **absence** — a route group with no shell, nested shells, a `not-found.tsx` at the wrong depth, chrome ingredients or extracted chrome in a wrapper, `@auth0` reaching `apps/pay` directly or through a package subpath |
| `eslint.config.mjs` (`no-restricted-imports` / `-syntax`) | editor + hook | a route file importing `@mutav/ui/sidebar` / `public-shell` / `sonner`, or a route wrapper inlining `<header>`/`<nav>`/`<aside>`/`<footer>`                                                                             |
| § 4 + CLAUDE.md                                           | planning      | picking the wrong shell before any file exists                                                                                                                                                                          |

Only the test can see absence: ESLint reads one file at a time, and "this route group has no shell" is a fact about the segment tree. It lives at the repo root because `packages/ui` has no `test` script and the per-app vitest configs run behind a changed-files filter — a check that surveys every app must not be filtered. It runs in the unfiltered `conventions` job of `.github/workflows/quality.yml`.

Four escape hatches the first cut of these gates left open, and what closes each:

| Escape                                                                                             | Closed by                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extract the header into `src/components/` and render it beside the shell                           | The test parses each wrapper, separates JSX in **child** position from JSX in **prop** position, and follows app-local child components one hop to re-read them |
| Put the chrome in `template.tsx` / `default.tsx` instead of `layout.tsx`                           | Both are route files now — templates join the shell chain, all three are chrome-checked, and the ESLint glob is `{layout,template,default}.tsx`                 |
| Import `@mutav/app-shell/convex-auth-provider` from `apps/pay` (the string `@auth0` never appears) | Test D taints every `@mutav/*` subpath whose source transitively reaches `@auth0` and greps `apps/pay` for those specifiers too                                 |
| Add a fifth app                                                                                    | `APPS`, the ESLint `rootDir` list, and `scripts/i18n-parity.mjs` all read `apps/` from disk instead of naming the four                                          |

Both gates were verified against a working reproduction of each escape before the closures landed; each reproduction fails at least one gate now.

The ESLint ban names specific specifiers, so a future `@mutav/ui/top-bar` would slip through. It is defense-in-depth; the test stays primary. The test's chrome follow is likewise **one hop** — a component that renders another component that hand-rolls a `<header>` is not detected. That is a deliberate bound: a route wrapper is a handful of lines by construction, and the refactor being closed is "move it next door".

**Not enforced anywhere:** "compiles but renders unstyled." Arbitrary-value classes referencing a CSS variable (`h-(--header-height)`, `w-(--sidebar-width)`) compile fine and collapse silently if the variable is undeclared — `<AppShell>` declaring both itself is what closes that. `scripts/regression-greps.sh` § 9 asserts the two declarations that make `@mutav/ui`'s classes reachable at all (`@source` + `transpilePackages`), but a vanished class still needs a human looking at the screen.
