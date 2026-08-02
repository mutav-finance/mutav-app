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

| #   | Configuration                        | Where                            | Auth-aware?            |
| --- | ------------------------------------ | -------------------------------- | ---------------------- |
| 1   | Sidebar + header                     | `agency/(app)`                   | no                     |
| 2   | Sidebar + header                     | `admin/(admin)`                  | no                     |
| 3   | PublicShell + inline header + footer | `agency/(onboarding)`            | **yes** — the only one |
| 4   | PublicHeader + footer                | `pay/[publicId]`                 | no                     |
| 5   | Top nav bar                          | `fund/(investor)`                | no                     |
| 6   | No chrome                            | `admin/access-denied`, both 404s | n/a                    |

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

**F3 — 404s are unstyled.** Every 404 renders Next's default page with no chrome, no brand, no way back. This is the largest unstyled surface in the product. Resolved in two parts: `[locale]/not-found.tsx` for `notFound()`, and `app/global-not-found.tsx` for unmatched URLs — the second was missed on the first pass, see § 5.

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
| **Bare** | brand + a way out                                   | `admin/access-denied`, both 404 files              |

Bare stays distinct from Flow: collapsing them would give `access-denied` and 404s chrome built for multi-step flows. "A way out" is one or two links, not a step counter — `access-denied` offers both a console link and a sign-out because its three session states need different exits. `BareShell`'s `brand` prop is **required**, so "brand" is a type error to omit rather than a convention only a reader can enforce.

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

Follows from D1. Every app gains **two** BareShell 404s: `[locale]/not-found.tsx` for `notFound()` thrown under `[locale]`, and `app/global-not-found.tsx` for URLs that match no route. A 404 inside `(app)` drops to Bare rather than keeping the sidebar — the route did not resolve, so the nav has nothing valid to reflect.

### D6 — `fund`'s nav is internationalized in the same change ✅

`InvestorNav` is rewritten for the shell migration anyway; doing F6 separately means touching one file twice.

### D7 — Auth0 Universal Login branding — OPEN

Out of scope for the shell work, but it is the first screen an unauthenticated user sees. While it stays default-Auth0, the unauthenticated experience is inconsistent regardless of what ships here. Track separately.

## 5. Scope that follows — shipped

1. ✅ `<AppShell>` / `<FlowShell>` / `<BareShell>` + a `Wordmark` component in `@mutav/ui`.
2. ✅ Migrate the chrome configurations onto them; delete the agency/admin duplicates.
3. ✅ `[locale]/not-found.tsx` + `app/global-not-found.tsx` in all four apps (Bare).
4. ✅ Replace the inline auth-aware header in `agency/(onboarding)` with a Flow identity slot.
5. ✅ i18n `InvestorNav`; wire its wallet button as `fund`'s identity slot.
6. ✅ Enforcement — see § 8.

Two rulings taken during implementation, recorded so they are not re-opened by omission:

- **`fund/(investor)` did not adopt `<AppShell>`.** D1 lists it under the App variant, but its arrangement is a top bar and serving both from one component would need either a boolean flag (forbidden by CLAUDE.md) or a `navPlacement` enum that drags `SidebarProvider`'s cookie/keyboard/CSS-var machinery into a sidebar-less app. § 6's unresolved contradictions sit under fund and none is test-covered. Deferred to § 7; `fund` still got D5, D6, and a real identity slot.
- **`pay`'s skip link now targets `#main-content`, not `#primary-action`.** The deleted `pay/[publicId]/layout.tsx` pointed a link labelled "skip to main content" at the payment CTA. `FlowShell` owns `<main id="main-content">`, so the label and the target now agree; the two orphaned `id="primary-action"` anchors were removed with it. A screen-reader user lands on the step's content rather than mid-panel.
- **`<BareShell>` mounts no `ThemeProvider`.** `admin/access-denied` renders outside any `ThemeProvider` today (only the `(admin)` group layout mounts one), so next-themes never stamps `<html>` for that route. Adding one would change the rendered output for system-dark viewers; the shell ships the existing inconsistency deliberately so the migration had zero rendered diff.

Corrected 2026-08-02. The earlier ruling ("no root-level `not-found.tsx` — the proxies rewrite everything into `[locale]`, so an unmatched path reaches `[locale]/not-found.tsx`") was wrong. The rewrite premise holds but the conclusion does not: after the rewrite `[locale]` matches and the _remaining_ segment misses, so Next resolves `/_not-found` — a routing-level miss against the **app-dir root**, where `[locale]/layout.tsx` never begins rendering. `apps/*/.next/server/app/_not-found.html` was Next's builtin page in all four apps. The fix is `app/global-not-found.tsx` behind `experimental.globalNotFound`; it replaces the root layout for that route, so it imports `globals.css`, re-declares the `Geist` font, and reproduces the `<html>`/`<body>` classes `PublicShell`'s `h-full flex-1` depends on. `[locale]/not-found.tsx` stays as the `notFound()` boundary.

A root `app/not-found.tsx` is banned for a **repo-specific** reason, not a Next.js rule: Next normally renders one inside `app/layout.js`, but these apps have no `app/layout.tsx` — the root layout is `app/[locale]/layout.tsx`, the top-level-dynamic-segment case `not-found.md` names as a reason to reach for `global-not-found` at all. With no root layout to wrap it, Next supplies a builtin `<html><body>`: no `lang`, no font variable, no theme class, and `BareShell` collapses inside it. State it that way wherever it is repeated (the hook's blocking message, test B2) — an app with a static root layout would not see this.

Verified after the change, in `next dev` and against a production `next build` + `next start`: `/nope`, `/en/nope` (renders `lang="en"`), `/fr/nope`, `/foo/bar.php`, `/nope.php`, and deep paths (`/investor/nope`, `/pay/nope/deep`) all render the branded BareShell 404 in all four apps — correct `lang`, `id="main-content"`, wordmark present, no sidebar.

**Dotted paths — fixed at the proxy matcher (2026-08-02).** A single-segment dotted path (`/nope.php`) used to skip the matcher's blanket `.*\..*` exclusion, so nothing rewrote it into a real locale and `[locale]` matched the dotted segment itself as the locale value. `agency` and `admin` have a page at the `[locale]` index (`(app)/page.tsx`, `(admin)/page.tsx`), so that route _resolved_, the root layout rendered, and its `hasLocale` guard threw `notFound()` **from the very segment that owns `[locale]/not-found.tsx`** — a throw escapes its own boundary, so it fell through to Next's builtin page. `pay` and `fund` were unaffected: neither has an index page at `[locale]`, so for them the path was already a true routing miss.

`export const dynamicParams = false` on the root layout was trialled and **rejected**: it fixes the case in `next dev` but changes nothing in a production build (verified by building `agency` with and without it). The shipped fix replaces `.*\..*` in all four `src/proxy.ts` matchers with an explicit **asset-extension** exclusion (`ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|eot|txt|xml|json|webmanifest|map|mp4|webm|pdf|csv`, anchored with `$`). A dotted path that is not an asset now reaches the middleware, gets rewritten into a real locale, misses as an ordinary route, and renders the branded global 404. Everything in `public/` is `.svg`/`.png` and `favicon.ico` is covered, so no static asset gained a middleware hop — add the extension here first if one ever ships with a new suffix.

**`notFound()` is never server-rendered — in any app.** Measured on `next dev` and `next start`, `[locale]/not-found.tsx` is real and correct, but its UI arrives in the RSC flight payload and paints on hydration; the SSR HTML carries none of it. This is React, not a wiring bug: Next's `NotFoundBoundary` is a client error boundary, and an error thrown outside every `<Suspense>` boundary fails the server shell. The two observable shapes, both documented upstream in `not-found.md` ("`200` for streamed responses, `404` for non-streamed"):

| Segment has a `loading.tsx` (⇒ a Suspense boundary) | Status | SSR HTML                                  |
| --------------------------------------------------- | ------ | ----------------------------------------- |
| yes — e.g. `agency/contracts/[id]`                  | `200`  | the loading skeleton, inside the shell    |
| no — e.g. every `pay/[publicId]` step               | `404`  | Next's `__next_error__` document, no body |

Both repair on hydration; both are blank-ish for a no-JS client or a crawler. Adding a `loading.tsx` to `pay` was trialled and **rejected**: it does not server-render the 404 (verified — the skeleton is what lands in the HTML), and it trades the correct `404` status on the product's highest-traffic 404 for a `200`. Do not "fix" one of these rows into the other believing it renders the 404 server-side. The only path that truly server-renders a branded 404 is `global-not-found.tsx`, which is why unmatched URLs are the case the gates are strict about.

## 6. Not investigated

- Mobile / responsive behavior of any nav — reviewed as source, not rendered at breakpoints.
- `apps/agency`'s `SidebarRoadmapItem` and `NavCadastros`, whose purpose was not established.
- Whether `fund`'s "scroll-with-document" root layout comment matches its `h-svh overflow-hidden` markup — they appear to contradict. `(investor)/layout.tsx` re-introduces `overflow-y-auto` on an inner div.

## 7. Follow-ups

**`fund/(investor)` adopts the App shell.** Gated on § 6's scroll-ownership question being resolved first, plus two things that make a shared shell unsafe today: the investor palette comes from a literal `dark` class on the `(investor)` div rather than next-themes (a shell owning that element would flip the portal to light in a way invisible in code review), and `fund` mounts no `ThemeProvider`, `Toaster`, or `TooltipProvider`.

Until then the layout is an explicit exemption in **`tests/shell-exempt-layouts.json`**, keyed by the repo-relative layout path and carrying its own `reason` and `tracking` — the rationale travels with the data rather than sitting in a comment next to it. Three assertions keep it from being a soft spot: the schema rejects an entry with no substantive justification, test E asserts the exempt path still exists, and test E also asserts the layout really does arrange its own chrome (the thing the exemption buys relief from), so a shell-less route group cannot be waved through by appending a line. Deleting the entry is the last step of the follow-up.

**`admin` and `fund` have no `notFound()` call site** other than their `[locale]/layout.tsx` locale guard, whose throw originates at the same segment as the boundary and so escapes it. Their `[locale]/not-found.tsx` is therefore unreachable today. Kept, not deleted: it is the boundary the moment either app gains a dynamic detail route.

**`fund`'s investor pages ship English strings under the default `pt-BR` locale.** D6 scoped i18n to `InvestorNav`, so the nav is translated and roughly forty page-body strings beneath it are not — a mixed-language surface at `fund.mutav.finance`. No gate sees it: `scripts/regression-greps.sh` § 8 checks key **parity** between an app's two locale files, not **coverage**, so `fund` passes with 14 chrome-only keys while the other apps carry 105–886. Closing it means extracting the investor page copy into `messages/*.json`; a coverage floor (keys-per-app, or a scan for bare Latin text in JSX) is the gate that would keep it closed.

**A scoped 404 inside the pay flow** is specified in `.design/projects/payment-flow/design/shared/component-plan.md` (`PaymentExpiredCard`, agency-branded, inside the flow chrome). Test B2 forbids a nested `not-found.tsx`, so that design needs D5 revisited — not a silent exception.

D7 (Auth0 Universal Login branding) also remains open — see § 4.

## 8. Enforcement

Four mechanisms, four moments. None of them can tell an author _which_ shell a new route wants — that is what § 4's table and [`../../CLAUDE.md` § "Which shell a new route gets"](../../CLAUDE.md#which-shell-a-new-route-gets) are for.

| Gate                                                      | Fires at      | Catches                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/shell-contract.test.ts` (`bun run test:structure`) | merge (CI)    | **absence** — a route group with no shell, nested shells, either 404 file at any path but its own (searched across the whole app dir, not just `[locale]/`), a `global-not-found.tsx` without its config flag, chrome ingredients or extracted chrome in a wrapper, an exemption with no justification or no chrome of its own, `@auth0` reaching `apps/pay` directly or through a package subpath |
| `.claude/hooks/shell-contract.js` (PreToolUse)            | write (agent) | **advisory**: a route wrapper with no shell and none above it, a page with no shell above it, nested shells, extracted chrome one hop away, a `global-not-found.tsx` off BareShell / without its config flag / without a full document. **Blocking**: a `not-found.tsx` anywhere but `[locale]/not-found.tsx`, or a `global-not-found.tsx` anywhere but the app-dir root                           |
| `eslint.config.mjs` (`no-restricted-imports` / `-syntax`) | editor + hook | a route file importing `@mutav/ui/sidebar` / `public-shell` / `sonner`, or a route wrapper inlining `<header>`/`<nav>`/`<aside>`/`<footer>`                                                                                                                                                                                                                                                        |
| § 4 + CLAUDE.md                                           | planning      | picking the wrong shell before any file exists                                                                                                                                                                                                                                                                                                                                                     |

The hook is a separate file from `.claude/hooks/code-quality.js` on purpose. That hook scans `tool_input.new_string` — the diff fragment — which for a three-line edit to an already-correct `layout.tsx` contains no import statement at all; a shell rule hosted there would report "no shell" on nearly every edit to a correct file. Shell rules need the whole file plus the sibling segment tree. The escape valves also differ: `code-quality.js` is silenced per line with `// hook-ok:`, which the merge gate never sees, whereas the shell contract's only exemption is `tests/shell-exempt-layouts.json` — a tracked allowlist CI reads too, and whose schema refuses an entry without a `reason` and a `tracking` reference. It stays advisory for shell _selection_ because the normal authoring sequence (create `layout.tsx`, then add the shell import) would otherwise be blocked mid-flight on partial information; only the two 404 paths CI rejects on sight are blocking, since those are pure path predicates with no judgment in them.

It is not redundant with the test. `bun run test:structure` derives its rows from **leaves**, so a route group whose `layout.tsx` mounts no shell is invisible until a `page.tsx` lands under it — verified by planting `[locale]/(reports)/layout.tsx` with no shell and no page: the hook flagged it, the test stayed green. The hook closes that window at the moment the layout is written.

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
