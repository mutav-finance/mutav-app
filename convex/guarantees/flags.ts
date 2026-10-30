/**
 * Product feature flags for guarantee pricing. A code constant rather than an
 * env var because `pricing.ts` runs in two runtimes — the wizard preview in the
 * browser and the `create`/`reprice` mutations in Convex — and one constant
 * cannot drift between them the way a `NEXT_PUBLIC_*` var and a Convex env var
 * could.
 *
 * `PRESTAMISTA_ENABLED`: the Plus plan (credit-life cover, _seguro
 * prestamista_). Off for the pilot: its premium is still a placeholder until
 * the insurance broker prices it. While off, the Plus plan is not offered in
 * the agency UI and every price is computed as Basic.
 */
export const PRESTAMISTA_ENABLED = false;
