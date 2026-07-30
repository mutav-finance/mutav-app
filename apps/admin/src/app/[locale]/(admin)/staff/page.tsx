import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { StaffManagement } from "@/components/staff/staff-management";

/**
 * Staff management surface — grant and revoke mutavStaff rows.
 *
 * Server-side gate mirrors the pattern from the review-queue page: layouts
 * render concurrently with pages in App Router, so the `(admin)` layout's
 * redirect doesn't stop this component's async body. The role-gated
 * `listAllStaff` preload would throw for a non-admin caller — the explicit
 * gate here fails politely (render `null`) instead.
 */
export default async function StaffPage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const preloaded = await preloadQuery(api.mutavStaff.useCases.listAllStaff, {}, { token });

  return <StaffManagement preloaded={preloaded} />;
}
