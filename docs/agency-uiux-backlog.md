# Agency app: UI/UX backlog

Single consolidated backlog of fixes and improvements for the agency app (`apps/agency`, app.mutav.finance). Compiled 2026-10-27 from a read-only UI/UX review of the live app (benchmarked against CredAluga) plus the founders' own review list. Items are not prioritized; the numbering below (1.1, 2.1, ...) is the only reference.

Complexity was sized the same day by reading the code on `fix/agency-ui-polish` (items already shipped are moved to § Done):

| Tag    | Meaning                                                                                   |
| ------ | ----------------------------------------------------------------------------------------- |
| **P**  | < 1 day; frontend or copy only, no backend change                                         |
| **M**  | 1 to 3 days; frontend + a simple Convex query/mutation change, no schema migration        |
| **G**  | 3 to 7 days; schema change, new backend flow, permissions, or several screens             |
| **GG** | > 1 week, or depends on an external service, or blocked by an open product/legal decision |

Summary of what is left: 1 P, 8 M, 5 G, 4 GG (3.1 counted as GG; it has a P stopgap). 1.4, 3.2, 7.1 and 7.3 were dropped after review; 6.1 is on hold; 2.3 and 4.1 are done.

## 1. Dashboard (Painel)

- **1.1 [M] Top KPIs.** "Próxima Fatura" gets a prominent button to Faturas; "Faturas em atraso" becomes "Inadimplência" = % of the agency's book delinquent in the last 30 days. The button alone is P. The Transparência rate is a protocol-wide point-in-time snapshot (`(default_verified + cover_committed) / in force`) with no 30-day window, so a new agency-scoped query replaying `guaranteeHistory` is needed (`getStateTimelineByPeriod` is a close precedent; no schema change). Open decisions: count vs value; "entered the window" vs "delinquent today"; variation vs the previous 30 days; whether `in_arrears` counts (Transparência excludes it). Becomes GG if these stay open. The label also collides with the Inadimplências page.
  `apps/agency/src/components/section-cards.tsx:71-118`, `convex/transparency/useCases.ts:18-70`, `convex/guarantees/useCases.ts:641-672`, `docs/transparency-metrics.md`
- **1.2 [M] "Próxima Fatura" shows an overdue invoice.** `getNextOpenInvoice` takes the first `open` invoice by ascending `periodMonth` even when past due. Filter `dueDate >= today` (`isOverdue` exists) and surface overdue ones separately; update tests. Where overdue invoices surface depends on 1.1 and 1.3.
  `convex/invoices/useCases.ts:231-254`, `convex/invoices/domain.ts:165-175`
- **1.3 [M] Greeting + "what needs your attention today" block** above the chart. The greeting is P (`currentUser.name` is in the workspace provider). The block can reuse `getOverdueCount`, `getStatusCounts` and `delinquencies.openStats`. Needs a product list of items and their priority.
  `apps/agency/src/app/[locale]/(app)/page.tsx`, `apps/agency/src/providers/workspace.tsx:107`

## 2. Guarantees and contract creation

- **2.1 [M] BUG: active contracts do not open.** Most likely cause: `getByPublicId` throws when no history row carries a `tenantSnapshot`, so guarantees created before the snapshot (#277) or outside `create` land on `error.tsx`. The comment in `tenantIdentity.ts` promises a fallback that does not exist. Fix with a tolerant read or a backfill, plus a test. Confirm against production Convex logs first.
  `convex/guarantees/useCases.ts:79-135` (throw at :127), `convex/guarantees/tenantIdentity.ts:8-34`
- **2.2 [M] Contract detail: information and actions per status.** There is no "Ativar" button: `guarantees.mutations.activate` has no UI caller. The actions menu (edit, duplicate, archive) is fully disabled. Needs a status x action matrix from product. Depends on 2.1.
  `guarantee-summary-card.tsx:87-185`, `guarantee-actions-menu.tsx:30-33`, `convex/guarantees/mutations.ts:98`
- **2.4 [G] Resume a creation stopped at step 4.** The `drafted` status does not fit: it is born only on step 4 submit and means a priced proposal awaiting activation. Wizard state lives only in `useReducer`. Needs a wizard-draft table (with personal data), a resume screen and an LGPD retention decision.
  `guarantee-wizard.tsx:19-23`, `wizard-step4.tsx:47`, `convex/schema.ts:367-376`
- **2.5 [M] Pending-action cards on top of the Guarantees list.** `getGuaranteeTabCounts` already returns drafts, upcoming expirations and arrears; pending documents and pending tenant approval need a new query. Depends on 2.2.
  `app/[locale]/(app)/guarantees/page.tsx:14-28`, `convex/guarantees/useCases.ts:342`
- **2.6 [G] Ask property purpose/subtype in Nova Garantia** (today Residencial/Comercial only). `propertyKind` is a closed union used by applications, leases and product eligibility; an optional subtype field avoids a migration. GG if the subtype affects pricing or risk.
  `convex/schema.ts:48,371,392,523`, `convex/leases/domain.ts:12-20`, `wizard-step1.tsx:160-174`

## 3. Invoices (Faturas)

- **3.1 [GG] Pay / download boleto.** No boleto issuer exists: `payments.method = boleto` only records a settlement; the real providers are Etherfuse (Pix) and Stellar. Needs a bank/PSP integration with settlement webhook. **P stopgap:** point the dashboard button at the existing checkout (Pix/Stellar).
  `apps/agency/src/components/invoices/invoice-method-card.tsx:46-67`, `convex/payments/providers/domain.ts:18-21`, `docs/architecture/decisions/0006-invoice-settlement-split.md`

## 5. Agency and account

Suggested order: 5.3, then 5.2 and 5.4. 5.1 is independent.

- **5.1 [M] Account settings** (personal data, password, notifications). The "Conta" and "Notificações" menu items have no href. Password goes through the Auth0 change-password flow. Notification preferences need a schema field (G). `nav-user` is shared with admin and fund.
  `packages/ui/src/nav-user.tsx:145-152`, `convex/users/useCases.ts:103`, `convex/lib/auth0Mgmt.ts:110`
- **5.2 [GG] Members page with email invites.** `memberships` exists; invites (token, expiry, create/accept/revoke, pre-onboarding accept route) do not. Resend is already wired. Open decision: Auth0 Organizations (`agencies.auth0OrgId`) vs Convex-only invites, which affects post-login routing.
  `apps/agency/src/components/nav-agency.tsx:25`, `convex/schema.ts:308-316`, `apps/agency/src/lib/user-destination.ts:50`
- **5.3 [G] Rename "Membros" to "Usuários" + roles (dono, gestor, operador) enforced in the backend.** `memberRole` (owner/admin/member) exists but no handler reads `ctx.membership.role`; the scope wrappers only check membership. Add a minimum-role helper and apply it to sensitive mutations (matrix planned in `compliance.md:234-242`). The copy rename alone is P; renaming schema values needs a migration.
  `convex/lib/auth.ts:12-35,77`, `convex/agencies/domain.ts:83-92`
- **5.4 [G] Agency settings page** (name, CNPJ, address, contacts). `agencies` has no address field (schema change). Decide whether CNPJ/representative lock after `active` or trigger a new review. Role guard comes from 5.3.
  `convex/schema.ts:119-126,248-283`, `convex/agencies/adminUseCases.ts:135`, `apps/agency/src/components/onboarding/step-profile.tsx`

## 6. Login and onboarding

- **6.1 [P] (on hold) Customize the Auth0 login screen** (logo, colors, texts). Tenant config is not in the repo: done in the Auth0 dashboard, twice (dev tenant, then `mutav-prod`, #119). See `nav-shell-audit.md:101,145` and #360. M if versioned as code.
- **6.2 [GG] Verify email and phone with a code.** Nothing exists today. Email code can come from Auth0 config; there is no SMS provider in the repo (only Resend). Decide Auth0 MFA vs own Convex flow (`phoneVerifiedAt`, rate limit).
  `convex/schema.ts:257`, `convex/agencies/useCases.ts:481`
- **6.3 [GG] KYC for the autonomous broker.** The broker skips the documents step; today's KYC/KYB is a manual staff review. The only `kycStatus` is Etherfuse's (anchor account). Likely vendor Avenia (`docs/conventions/deferred.md:54`). G if it is document upload + manual review.
  `apps/agency/src/components/onboarding/use-onboarding-flow.ts:107,187`, `convex/agencies/adminUseCases.ts:8`
- **6.4 [G] Terms acceptance recorded (who, when, version).** Today it is passive copy; only `consentMarketing` is stored and `/termos`, `/privacidade` have no route. Needs a required checkbox, a `consents` table and a mutation. GG until counsel delivers the texts.
  `apps/agency/src/components/onboarding/step-review.tsx:128-160`, `convex/agencies/useCases.ts:445-547`

## 7. Cross-cutting

- **7.2 [M] Empty states that teach** (steps + CTA). No shared `EmptyState` component; about 5 screens (Garantias, Faturas, Inadimplências, Comissão, empty dashboard) plus detail cards.
  `guarantee-list-table.tsx:386-398`, `invoice-list-table.tsx:359`, `delinquency-page.tsx:305`, `commission-page.tsx:182`

## Proposed plan

1. **Quick wins (about 1 week):** 2.1, 1.2, and the 5.3 copy rename. 6.1 waits for a later round.
2. **Dashboard and guarantees (1 to 2 weeks):** 1.1 (with the 3.1 stopgap on the button), 1.3, 2.2, 2.5, 7.2, 5.1. Needs decisions first: delinquency metric, "attention today" items, actions per status.
3. **Team and agency profile (2 to 3 weeks):** 5.3, then 5.2 and 5.4.
4. **Blocked on third parties (start the conversations now):** 3.1 (PSP), 6.2 (SMS), 6.3 (KYC vendor), 6.4 (counsel), 2.4 (LGPD), 2.6 (underwriting).

## Done

Shipped on `fix/agency-ui-polish` (PR #381):

- **2.3** Removed the "Valor locatício aprovado" card from wizard step 2 (`8e9c13a`).
- **4.1a** Status tag is a tinted pill with a plain label, no uppercase/mono; denser fill in dark mode (`8e9c13a`, `e462551`).
- **4.1b** `cover_committed` gets its own ink swatch and `default_verified` uses the brand orange `#d4781a`, both clearing the OKLab/CVD floors (`8e9c13a`, `0b21960`).

## Decisions already made (do not reopen)

- "Garantia" in the app UI is intentional (the avoid-"garantia" rule applies to marketing only).
- Keep the "EM BREVE" menu items; the path is to build the pages (5.2, 5.4).
- Delinquency guide: dropped (a product Mutav does not offer).
- CredAluga-style "quick actions": optional, probably not needed.
- Dropped: simplifying the "Carteira vigente" chart (was 1.4), unifying seed invoice IDs (was 3.2), Transparência scope/jargon copy (was 7.1), and all of 7.3 (tab titles stay as on main; "Outubro De" and heading copy fixes).

## Keep

Clickable "Onde a carteira está" funnel, top KPIs, tables with filters/search/columns, "Criar Garantia" CTA, 5-step stepper, Transparência, Comissão with invoice (nota fiscal).

## Do not copy from CredAluga

Home as a cross-sell showcase, KPIs with no action, chat widget covering content, promo popup on login, cross-sell banner before opening a delinquency, giant "no results" screen, hidden filter that empties the list.
