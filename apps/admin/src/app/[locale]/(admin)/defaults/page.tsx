import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { DefaultsQueue } from "@/components/defaults/defaults-queue";

const QUEUE_PAGE_SIZE = 25;

/**
 * A3 — the defaults queue. Cross-agency, FIFO by `openedAt`, holding every
 * notice compliance still owes a decision, followed by the covers it has
 * recorded whose off-chain payout is still unconfirmed.
 *
 * Re-checks the staff gate here, not only in the `(admin)` layout: App Router
 * renders the layout and page concurrently, so the layout's `redirect()` does
 * NOT stop this server component's async body. Without the guard, the
 * role-gated `preloadQuery` fires — and throws — for a non-staff request
 * before the redirect lands.
 */
export default async function DefaultsQueuePage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const [preloaded, payoutsPreloaded] = await Promise.all([
    preloadQuery(
      api.delinquencies.useCases.listOpenAdminQueue,
      { paginationOpts: { numItems: QUEUE_PAGE_SIZE, cursor: null } },
      { token },
    ),
    preloadQuery(
      api.coverOperations.useCases.listAwaitingPayout,
      { paginationOpts: { numItems: QUEUE_PAGE_SIZE, cursor: null } },
      { token },
    ),
  ]);

  return <DefaultsQueue preloaded={preloaded} payoutsPreloaded={payoutsPreloaded} />;
}
