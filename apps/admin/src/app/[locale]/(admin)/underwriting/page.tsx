import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { UnderwritingQueue } from "@/components/underwriting/underwriting-queue";

const QUEUE_PAGE_SIZE = 25;

/**
 * Mutav's underwriting queue: drafts whose agency asked for analysis, oldest
 * request first, plus accepted drafts whose contract still has to be sent.
 *
 * Re-checks the staff gate here, not only in the `(admin)` layout: App Router
 * renders the layout and page concurrently, so the layout's `redirect()` does
 * not stop this server component's role-gated `preloadQuery` from firing.
 */
export default async function UnderwritingQueuePage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const [queue, awaitingDispatch] = await Promise.all([
    preloadQuery(
      api.guarantees.reviewQueries.listAnalysisQueue,
      { paginationOpts: { numItems: QUEUE_PAGE_SIZE, cursor: null } },
      { token },
    ),
    preloadQuery(api.guarantees.reviewQueries.listAwaitingDispatch, {}, { token }),
  ]);

  return <UnderwritingQueue queue={queue} awaitingDispatch={awaitingDispatch} />;
}
