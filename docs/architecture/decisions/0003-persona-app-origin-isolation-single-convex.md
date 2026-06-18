# ADR 0003 — Persona-app origin isolation on a single-Convex monorepo

**Status:** Accepted (2026-05-31) · **Phase:** monorepo migration ([#139](https://github.com/mutav-finance/mutav-app/issues/139)) · **Staged-PR sequence:** [`../../superpowers/specs/2026-05-31-monorepo-migration-design.md`](../../superpowers/specs/2026-05-31-monorepo-migration-design.md) (transient plan)

## Context

The app began as one Next.js deployment hosting four distinct shells (agency dashboard, tenant payment, investor portal, Mutav admin) via App Router route groups. As the surfaces diverge by actor, trust posture, and regulatory exposure (custody, RWA, BACEN cyber-resilience), the question was whether to keep one origin or split per persona — and how that interacts with the single-writer audit log.

This ADR records the **decisions**; the staged-PR sequence and migration mechanics live in the (transient) migration spec linked above. Several canonical docs ([README.md](../README.md) App/Shell catalogs + trust boundaries, [admin.md](../admin.md), [investor.md](../investor.md)) reference this decision set — they should cite **this ADR** as the authority, and the spec only for the PR sequence.

## Decision

1. **Per-app subdomains for the four persona apps** — origin isolation is the institutional default for regulated fintech/RWA/custody surfaces. A route-group-only split is rejected. Targets: agency `app.mutav.finance`, pay `pay.mutav.finance`, fund `fund.mutav.finance`, admin `admin.mutav.finance`.
2. **Tenant payment extracted to `apps/pay/` on its own origin** — cookie scope, phishing posture, BACEN 4.658 cyber-resilience floor. `apps/pay/` carries **no Auth0 SDK** (limits blast radius of an Auth0 vulnerability; defends against phishing UI).
3. **`mutavStaff` Auth0 connection is administratively distinct** from the agency-staff connection — mandatory MFA at the Auth0-rule level, IP allowlist, shorter session lifetime, no self-signup. Escalation path = a separate Auth0 _tenant_ if BACEN/CVM diligence requires it.
4. **Convex stays at the repo root as a single deployment** (the Mutav API). **Load-bearing:** the hash-chained audit log + daily Merkle anchor ([reliability.md](../reliability.md) § Audit log integrity) requires a single writer. Per-app Convex backends are explicitly rejected.
5. **All session cookies are `Host-Only`** — no `Domain=.mutav.finance`, ever. Pair with `SameSite=Strict`, `Secure`, `HttpOnly`. Forecloses cross-subdomain cookie leakage between staff (`apps/admin`) and customer surfaces. This is the enforcement mechanism behind trust boundary #10 (cross-origin containment).
6. **Workspace-first, packages-on-demand** migration strategy — YAGNI on package boundaries; extract a shared package only when a second consumer appears.
7. **The existing Convex domain catalog wins over `mutav-stellar#57`'s sketch** — `#57`'s `investments`/`fundMgmt` are not adopted as domain names; their scope is split across `fundState` · `nav` · `contracts` · `mutavStaff`. `agencies` · `payments`(→`invoices`) · `compliance` carry over.
8. **`mutav-fund` archive is gated on three checkpoints** (incl. wallet-kit spec + feature-parity audit); archive only when all complete.
9. **Vercel Team Environment Variables for v1**, with a documented trigger to migrate to an external secrets manager.
10. **Per-app CI test + deploy gating** via `turbo-ignore` / `turbo --filter`; per-app CODEOWNERS land in the first migration PR.

## Consequences

**Positive:** origin isolation contains the blast radius of an Auth0 or admin compromise (trust boundary #10) without splitting the backend; the single-Convex rule keeps the audit log's single-writer invariant intact; the catalog-wins decision avoids a disruptive rename.

**Negative / cost:** cross-origin shell-switching requires a fresh Auth0 session per origin (Host-Only cookies); per-app deployment + CODEOWNERS + CI gating is operational overhead; the migration is a staged multi-PR effort (sequence in the migration spec).

## Status note

Pre-migration, the authenticated shells share one origin — the cross-origin boundary (#10) and the per-app cookie posture are **future commitments**, not current controls, until the migration PRs land.
