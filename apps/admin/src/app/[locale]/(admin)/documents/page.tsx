import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { DocumentsReviewQueue } from "@/components/documents/documents-review-queue";

/**
 * Guarantee documents awaiting compliance review — the signed rental contract
 * first among them, since its approval gates activation.
 *
 * Re-checks the staff gate here as well as in the `(admin)` layout: App Router
 * renders layout and page concurrently, so the layout's redirect does not stop
 * this page's role-gated `preloadQuery` from firing for a non-staff request.
 */
export default async function DocumentsReviewPage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const { token } = gate;

  const preloaded = await preloadQuery(
    api.guarantees.staffDocuments.listDocumentsPendingReview,
    {},
    { token },
  );

  return <DocumentsReviewQueue preloaded={preloaded} />;
}
