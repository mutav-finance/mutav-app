import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { ReviewQueue } from "@/components/review-queue";

/**
 * Onboarding review queue — the staff landing for apps/admin.
 *
 * Re-checks the staff gate here, not only in the `(admin)` layout: App Router
 * renders the layout and page concurrently, so the layout's `redirect()` does
 * NOT stop this server component from running its async body. Without the
 * guard, the aud-bound `preloadQuery` would fire — and throw — for an
 * anonymous or non-staff request before the redirect lands. Only a confirmed
 * staff member reaches the preload, with their Auth0 id token as the bearer.
 */
export default async function AdminReviewQueuePage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const preloaded = await preloadQuery(api.mutavStaff.useCases.listPendingReviews, {}, { token });

  return <ReviewQueue preloaded={preloaded} />;
}
