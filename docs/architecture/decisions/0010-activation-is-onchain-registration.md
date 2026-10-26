# ADR 0010 — Activation is the on-chain registration, not a click

**Status:** Accepted (2026-10-25) · **Decided by:** Julia (CTO) · **Phase:** First agency onboarding ([#378](https://github.com/mutav-finance/mutav-app/issues/378)) · **Supersedes:** the 2026-10-19/20 rule in #378 that the agency activates · **Related:** [ADR 0007](0007-lease-guarantee-split.md) (lease ↔ guarantee), [#369](https://github.com/mutav-finance/mutav-app/issues/369) Task 14 (operator actions), mutav-protocol-solana `register_guarantee` (spec §5.2), [security baseline](https://github.com/mutav-finance/mutav-protocol-solana/blob/main/docs/security/baseline.md) (ADR 0031, proposed)

## Context

The first real agency needs a defined moment when a guarantee starts. Three facts made "who clicks Activate" the wrong question:

1. **Only the reserve can say yes.** The operator's `register_guarantee` is refused when the reserve is paused, frozen or under-covered, when the cover exceeds the per-guarantee cap, or when cover × `c` does not fit the free capital (`InsufficientFreeCapital`). Convex never checks this: on `main`, `activate` marks a guarantee `active` and bills it even if the reserve would refuse it.
2. **Nothing defines when the fiança takes effect.** The Brazil pilot paper's target is that the fiança cites the on-chain guarantee id and takes effect only once registered; it is marked open. Without that link MUTAV can be named fiador in a signed lease with no reserve backing.
3. **The open PRs each picked a clicker.** #377 lets compliance staff activate; #380 lets only the agency activate. Neither ties activation to the chain.

## Decision

**A guarantee becomes `active` when its `register_guarantee` is confirmed on-chain. Nobody clicks Activate.**

```
drafted
  editing → analysis_requested → accepted (rate fixed)
          → awaiting_signature      preflight vs free capital − active holds; holds cover × c for 7 days
                                    (expired → hold released; re-send re-runs the preflight)
          → signed                  signed contract uploaded (agency or staff) and approved by compliance
          → pending_registration    queued for the operator automatically
active                              register_guarantee confirmed; the tx signature is stored on the guarantee
```

1. **Signed is not active.** Compliance approving the signed contract moves the review to `pending_registration` automatically.
2. **`active` = confirmed registration.** Pilot: the operator signs `register_guarantee` by hand (reserve `/operator`); staff record the tx signature in admin, and Convex verifies it on-chain before the transition. Later (#369 Task 14): a KMS-backed Convex action signs and confirms. The states do not change.
3. **Refusal is a visible state, not an error.** The guarantee stays `pending_registration` with the program's error code shown in admin. Staff wait for capital or cancel the draft; the agency sees that the guarantee is waiting for reserve capacity.
4. **Preflight and a 7-day hold before signatures.** At `accepted → awaiting_signature` Convex reads the reserve's free capital and **holds** the offer's required coverage (cover × `c`) for 7 days. The preflight measures free capital minus every active hold, so two offers cannot both pass and then race at registration. Signed within 7 days: the held allocation goes to registration. Expired: the hold is released, and re-sending the offer re-runs the preflight. A hold cannot stop free capital from shrinking during the week (a claim payment, a NAV move); the on-chain gate stays the final check, and the counsel clause in point 6 covers that edge.

   **This hold is valid only while one operator registers against the reserve.** Convex sees every consumer of free capital only because MUTAV's operator is the sole caller of `register_guarantee`. If a second operator is ever authorized (ADR 0020 allows the role to sit with a separate company), or a second platform registers against the same reserve, the hold must move on-chain: a reservation instruction with an expiry, which needs a protocol ADR and spec change in mutav-protocol-solana. **Revisit trigger:** any change to who holds the operator role, or a second registrant.

5. **Billing starts at `active`.** The activation fee and the monthly fee are never charged for cover that does not exist yet.
6. **Cover starts at registration.** No separate lease-start date for the pilot. The fiança text should say it takes effect on registration and cite the on-chain guarantee id — **a counsel item** (mutav#212).
7. **A lease that never starts** after registration is undone with `close_guarantee(CLOSE_VOID)` and closed in Convex.

## Consequences

- **#375** (document review) and **#376** (underwriting, rate fixed at acceptance) stay. #376's ADR must be renumbered (0010 is this one).
- **#377** is reworked: `staffActivate` becomes `signed → pending_registration` on contract approval plus `confirmRegistration({ txSignature })`; its activation-fee billing fix stays, triggered from `active`.
- **#380** is closed: an agency-only Activate no longer fits.
- **Convex stops being the source of truth for capacity.** The reserve's free capital, read from the chain, minus Convex's active holds, gates sending for signature; `insuredCentsPlatform` stays a display figure.
- **Single-operator assumption.** The off-chain hold is sound only with one registrant. Moving the operator role (ADR 0020) or adding a registrant reopens this ADR.
- **Throughput in the pilot is bounded by manual operator signing.** Acceptable at pilot volume; #369 Task 14 removes it.
- **Open:** the counsel wording of the fiança start clause; the waiting period (carência) stays out of scope (ADR 0007 §9).
