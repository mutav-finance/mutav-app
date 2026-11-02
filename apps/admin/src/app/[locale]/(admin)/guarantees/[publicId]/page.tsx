import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { ActivationDetail } from "@/components/guarantees/activation-detail";

/**
 * One guarantee as compliance activates it: summary, review stepper, the
 * guarantee's documents and the Activate action with every precondition
 * named. Same concurrent-render staff re-check as the list page.
 */
export default async function GuaranteeActivationPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId } = await params;
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const preloaded = await preloadQuery(
    api.guarantees.activationQueries.getActivationDetail,
    { publicId },
    { token },
  );

  return <ActivationDetail preloaded={preloaded} />;
}
