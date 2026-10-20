import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { GuaranteeView } from "@/components/guarantees/guarantee-view";

/**
 * One guarantee, staff side: its summary and its signed contract (upload /
 * replace / download). Activation is the agency's, so there is no Activate.
 *
 * Re-checks the staff gate: the `(admin)` layout's redirect does not stop this
 * server component's body, and the staff-gated preload throws for non-staff.
 */
export default async function GuaranteePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const { id } = await params;
  const publicId = decodeURIComponent(id);
  const preloaded = await preloadQuery(
    api.guarantees.signedContracts.staffGetGuarantee,
    { publicId },
    { token },
  );

  return <GuaranteeView publicId={publicId} preloaded={preloaded} />;
}
