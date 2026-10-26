# ADR 0011 — Mutav underwriting review: a sub-status inside `drafted`, the score as input, a staff-set rate

**Status:** Accepted (2026-10-20) · **Phase:** First-agency launch · **Related:** [ADR 0002](0002-b2b2c-tenant-credit-data-governance.md) (Mutav is the controller that decides), [ADR 0007](0007-lease-guarantee-split.md) (the seven-state machine this leaves untouched), [`underwriting.md`](../underwriting.md), [`guarantee-lifecycle.md`](../guarantee-lifecycle.md) § 4 and § 6.1a

## Context

The flow the business runs for the first agency: _the agency drafts a guarantee, selects and adjusts the product, and asks Mutav to analyse the tenant. Mutav accepts — setting the fee rate — or refuses. If accepted, the contract goes to the tenant to sign; once signed, Mutav registers the document and activates the guarantee._

Before this decision the code had no Mutav decision at all. `guarantees.create` read the bureau score, mapped it to a tier, priced from the product's tier rate and — for a `negado` tier — refused the draft outright with `TENANT_DENIED`. The bureau's band was the verdict, and nobody at Mutav was in the loop between the agency's draft and activation.

## Decisions

### 1. The review is a sub-status inside `drafted`, not a new lifecycle state

`guarantees.underwriting.review` takes `editing → analysis_requested → accepted → awaiting_signature → signed`, with `refused` as the other terminal. The legal moves are a pure map plus `assertReviewTransition` in [`convex/guarantees/review.ts`](../../../convex/guarantees/review.ts), proven by an exhaustive 6×6 matrix in [`review.test.ts`](../../../convex/guarantees/review.test.ts) — the same shape as the lifecycle machine.

The seven-state machine answers one question — _is Mutav on risk?_ — and every aggregate, insured-state read, capacity rule and timeline replay keys on it. The review answers a different one — _where is the decision to go on risk?_ — and nothing about it changes exposure: a draft in any review status is equally not insured and reserves nothing. Splitting `drafted` into five lifecycle states would have rewritten the transition matrix, the aggregates' key sets and the state timeline for no change in risk. The cost is one more field to read when you want "drafts Mutav must decide on"; the queue index `by_review_status_requestedAt` (`underwriting.review`, `status`, `underwriting.analysisRequest.requestedAt`) makes that a single indexed range.

`signed` exists in the value object before anything writes it, so the signed-document upload and staff activation that follow need no schema change.

### 2. The bureau score is an input, not the decision

`create` no longer refuses a `negado` score; `TENANT_DENIED` is gone. The score and tier are still re-read server-side from the agency's own assessment (never accepted from the caller) and recorded on the draft, and `requestAnalysis` re-reads the freshest one again so compliance reviews a current score. Mutav decides; the score informs it. This is also the posture LGPD art. 20 asks of an automated credit signal — a human decision with the score as one input.

Because the catalog carries no rate for `negado`, a draft with that tier is quoted at the worst priceable tier (`provisionalPricingTier`: `negado → ruim`) and the agency UI labels the figure provisional.

### 3. Compliance sets the rate on acceptance

`acceptAnalysis` takes a rate in basis points, bounded to **1%–30%** of monthly rent (`MIN_STAFF_FEE_RATE_BPS` / `MAX_STAFF_FEE_RATE_BPS`), and re-snapshots `terms` through the same product resolution and `priceGuarantee` as `create` and `reprice`, with the staff rate replacing the tier rate. The rate is stored twice on purpose: `terms.feeRateBps` (new on every snapshot — the rate `taxaFeeCents` was priced at, tier-derived or staff-set) and `underwriting.decision.feeRateBps` (what compliance decided). `underwriting.tier` keeps the bureau's band unchanged. A later `reprice` keeps the staff rate: it was a decision about this tenant, and the catalog rate is not.

The bounds are a typo guard, not a pricing policy: wide enough to price above the catalog's worst tier (15%) for a tenant the bureau scored low, narrow enough that 0% or 120% is refused instead of signed.

### 4. A refusal closes the draft with its own close reason

`refuseAnalysis` requires a reason and, in the same transaction, closes the guarantee through `applyGuaranteeTransition` with the new close reason **`underwriting_refused`**, legal only from `drafted`. The reason is stored as the closure note and on `underwriting.decision`. Refusal is **final for that draft**: the review map has no exit from `refused`, and the close releases `leases.openGuaranteeId`, so the agency's next step is a new draft (and a fresh analysis), never reopening this one. `canceled_pre_activation` stays the agency (or staff) _withdrawing_ a draft; `underwriting_refused` is Mutav _declining_ it — two different facts for reporting and for the tenant's art. 20 rights.

### 5. Who does what

- **Agency** (`mutationWithActiveAgency`): `updateDraft` (plan / product / rent, only while `editing`; the rent moves on the lease too) and `requestAnalysis`.
- **Compliance staff** (`mutationWithMutavRole({ minRole: "compliance" })`): `acceptAnalysis`, `refuseAnalysis`, `markSentForSignature`. The staff reads (`listAnalysisQueue`, `listAwaitingDispatch`, `getAnalysisDetail`) are gated at `compliance` too, not at any-staff: they put a tenant's credit score and identity on screen, and `support` is the KYC rung — the line the defaults queue already draws.
- **Sending the contract** is manual in the pilot. There is no e-signature integration; compliance sends the contract and records it with `markSentForSignature`. The tenant proposal notification moved from `create` to this step, because only now is there something for the tenant to sign.

Every move writes a `guaranteeHistory` row and a hash-chained audit entry (`guarantee.draft_updated`, `guarantee.analysis_requested`, `guarantee.analysis_accepted`, `guarantee.analysis_refused`, `guarantee.sent_for_signature`; the refusal's close also emits `guarantee.transitioned`). Accept and refuse schedule an email to the agency (skipped when Resend is not configured).

## Consequences

- The agency UI shows the review as a stepper on the guarantee page with a "Request Mutav analysis" button while editing; the wizard ends on the created draft with the same button rather than submitting the request implicitly. The admin app gains `/underwriting` (queue + case file).
- `activate` is still callable by the agency on any draft. Gating activation on `signed`, and moving it to staff, is the follow-up that consumes this sub-status. (Followed up, then superseded by [ADR 0010](https://github.com/mutav-finance/mutav-app/pull/390): approving the signed rental contract queues `pending_registration`, `markSentForSignature` became the `sendForSignature` action with a reserve preflight and offer hold, and activation is the confirmed on-chain registration — [`guarantee-lifecycle.md`](../guarantee-lifecycle.md) § 6.1b.)
- The `coverageDecisions` composition sketched in `underwriting.md` is still unbuilt; `underwriting.decision` is the pilot's human decision record until it lands.
