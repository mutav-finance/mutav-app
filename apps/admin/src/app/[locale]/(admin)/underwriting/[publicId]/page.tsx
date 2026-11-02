import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { UnderwritingDetail } from "@/components/underwriting/underwriting-detail";

/**
 * One underwriting case file: tenant, lease, bureau score and signals, the
 * terms on the table, and the accept / refuse / send-for-signature actions.
 * Same concurrent-render staff re-check as the queue page.
 */
export default async function UnderwritingDetailPage({
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
    api.guarantees.reviewQueries.getAnalysisDetail,
    { publicId },
    { token },
  );

  return <UnderwritingDetail preloaded={preloaded} />;
}
