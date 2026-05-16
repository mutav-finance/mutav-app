# Accessibility Fixes

> Chunk: accessibility-fixes | Phase: critique | Project: payment-flow | Generated: 2026-05-13
> Scope: Critical and Major severity items from the WCAG 2.2 AA audit. See `accessibility-audit.md` for the full pass/fail matrix.

## Violations table

| # | Issue | Severity | WCAG Criterion | Location | Remediation |
|---|---|---|---|---|---|
| 1 | Focus indicator implementation risk: STYLE.md mandates `border-color` focus (no ring/outline). Every focusable element must have a 1px ever-present border so the focus shift has somewhere to land. shadcn `Button` `default` variant ships without an explicit baseline border. | Major | 2.4.7 Focus Visible (AA), 2.4.11 Focus Not Obscured (AA), 1.4.11 Non-text Contrast (AA) | Build-phase implementation of every focusable element (CTAs, copy buttons, locale switch, explorer link, tabs, disclosure trigger). Cross-screen. | **In the build phase**, apply `border: 1px solid transparent` as the baseline on every interactive element, then shift to `border-color: var(--color-accent)` on `:focus-visible`. Verify focus contrast `#C47E10` on `#FFFFFF` = 3.1:1 (passes 3:1 for UI components). Add a Storybook (or in-app) test page that tabs through every focusable element on each screen. Pin a build-phase verification step. |
| 2 | Mono error-code line on `error.tsx` uses `--color-text-3` (`#9E9C98` on `#FFFFFF` = 2.6:1) — below AA 4.5:1 for normal text. | Critical | 1.4.3 Contrast (Minimum) | `../design/screen-06-error.md` §"Color contrast" (the "Código: …", "Ref: …" lines) | Escalate to `--color-text-2` (`#6B6860` on `#FFFFFF` = 4.5:1). Design author flagged + offered this fix. Update Screen 06 design chunk to specify `--color-text-2`; verify in build. |
| 3 | Reflow risk at 320px viewport. M-address 4×14 chunking at 0.875rem fits within the 360px design baseline but may overflow at 320px (older iPhone SE, kiosk browsers). | Major | 1.4.10 Reflow (AA) | `../design/screen-02-address-mode.md` §"Layout (mobile, 360px baseline)" + `../design/shared/responsive.md` | At `@media (max-width: 360px)`: reduce M-address chunking to 5 lines × 12 chars (still divides 56 with a remainder fix — use `MAAAAAAAAAAAA / AAAAABBBBBBBB / BBBBBBBCCCCCC / CCCCCCCCCCCC= / =` and ensure the `aria-label` carries the unbroken 56-char string). Test in build at 320×568 baseline. |
| 4 | Agency-contact info relocation: present in `PublicFooterMeta` on Screens 01/02/03/05/06/07 but moves *inside* the card body on Screen 04 (receipt). Per WCAG 3.2.6 Consistent Help (A), help mechanisms should appear in the same relative order across pages. | Major | 3.2.6 Consistent Help (A) | `../design/screen-04-receipt.md` §"Components used" (agency contact block inside card) vs other screens (in PublicFooterMeta) | Two acceptable resolutions: **(a)** Keep both — agency-contact in the footer remains, the receipt card *additionally* surfaces it as part of the receipt body (the footer copy is redundant on receipt but consistent across the flow). **(b)** Standardize on the in-card placement for all "end-state" screens (04, 05, 06, 07) and slim the footer to just the locale switch across the flow. Recommend (a) — the footer's consistency wins; the in-card block is supplemental, not a replacement. Update screen-04 design to keep the footer agency-contact line and let the in-card block serve as an additional anchor. |
| 5 | Reduced-motion behavior for the live-pulse dot needs build verification. Current spec says it "swaps to a static square" — but the design also says "the live pulse continues (status signal)" elsewhere. Conflict. | Minor (build-clarification) | 2.3.3 Animation from Interactions (AAA) | `../design/screen-02-address-mode.md` §"Reduced motion" + `../design/shared/micro-interactions.md` §"Reduced-motion override" | Resolve to one rule: under `prefers-reduced-motion: reduce`, the dot becomes a static `#C47E10` square (no animation) but a sibling Mono line "Verificação ativa" is added so the status signal is preserved via text, not motion. Update both design chunks to remove the contradiction. |

## Remediation summary

| Action | Owner | Phase |
|---|---|---|
| Update `screen-06-error.md` design chunk: change Mono color from `--color-text-3` to `--color-text-2` | Design (this critique loop) | Critique → Design refinement (minor, no full re-design) |
| Update `screen-02-address-mode.md` + `responsive.md`: add 320px breakpoint reflow rule for M-address chunking | Design | Critique → Design refinement |
| Update `screen-02-address-mode.md` + `micro-interactions.md`: resolve reduced-motion contradiction (static square + text fallback) | Design | Critique → Design refinement |
| Build-phase: implement global 1px transparent border baseline on every focusable element | Build | `/gsp-project-build` |
| Build-phase: keyboard-tab audit of every screen in Storybook / Playwright | Build | `/gsp-project-build` |
| Build-phase: visual reflow test at 320×568 viewport | Build | `/gsp-project-build` |
| Build-phase: i18n parity audit for the accessibility statement (en + pt-BR) | Build | `/gsp-project-build` |

## Verdict

No critical violations that block the build phase. The single Critical (Mono color contrast on error.tsx) has an author-offered fix that needs to be taken before build. The four Major items are addressable in build via verification routines.

**Recommendation:** Update the three design chunks named above (`screen-06-error.md`, `screen-02-address-mode.md`, `shared/responsive.md`, `shared/micro-interactions.md`) inline as part of this critique loop. The build phase carries the remaining verification work.

## Cross-references

- Critique: [critique.md](./critique.md)
- Prioritized fixes (screen-level): [prioritized-fixes.md](./prioritized-fixes.md) — note that prioritized-fixes.md row "Critical #2" duplicates the Critical row in this file (intentional cross-reference, both fix lists should be tracked in build)
- Design chunks affected:
  - [`../design/screen-02-address-mode.md`](../design/screen-02-address-mode.md) — reflow + reduced-motion
  - [`../design/screen-04-receipt.md`](../design/screen-04-receipt.md) — agency contact consistency
  - [`../design/screen-06-error.md`](../design/screen-06-error.md) — Mono color contrast
  - [`../design/shared/responsive.md`](../design/shared/responsive.md) — 320px reflow
  - [`../design/shared/micro-interactions.md`](../design/shared/micro-interactions.md) — reduced-motion clarification
