import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { ActivationQueue } from "@/components/guarantees/activation-queue";

/**
 * Drafts on the road to activation, across every agency: signed drafts
 * waiting for reserve capacity, and contracts still out for signature
 * (phase-1 rule, issue #427).
 *
 * Re-checks the staff gate here, not only in the `(admin)` layout: App Router
 * renders the layout and page concurrently, so the layout's `redirect()` does
 * not stop this server component's role-gated `preloadQuery` from firing.
 */
export default async function GuaranteesPage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const [awaitingCapacity, awaitingSignature] = await Promise.all([
    preloadQuery(
      api.guarantees.activationQueries.listActivationQueue,
      { review: "awaiting_capacity" },
      { token },
    ),
    preloadQuery(
      api.guarantees.activationQueries.listActivationQueue,
      { review: "awaiting_signature" },
      { token },
    ),
  ]);

  return (
    <ActivationQueue awaitingCapacity={awaitingCapacity} awaitingSignature={awaitingSignature} />
  );
}
