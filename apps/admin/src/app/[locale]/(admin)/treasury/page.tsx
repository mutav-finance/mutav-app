import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getStaffMember } from "@/lib/auth";
import { TreasuryScreen } from "@/components/treasury/treasury-screen";

/**
 * A4 — treasury. The pulse reserve, the capacity it backs and the BRL
 * exposure of the guarantee book, from the same platform-wide queries the
 * agency transparency page reads.
 *
 * Re-checks the staff gate here, not only in the `(admin)` layout: App Router
 * renders the layout and page concurrently, so the layout's `redirect()` does
 * NOT stop this server component's async body, and the token-bearing preloads
 * would fire for a non-staff request before the redirect lands.
 */
export default async function TreasuryPage() {
  const gate = await getStaffMember();
  if (gate.kind !== "staff") return null;

  const token = gate.session.tokenSet.idToken;
  if (!token) return null;

  const [preloadedCoverage, preloadedAggregates] = await Promise.all([
    preloadQuery(api.transparency.useCases.getReserveCoverage, {}, { token }),
    preloadQuery(api.transparency.useCases.getGuaranteeAggregates, {}, { token }),
  ]);

  return (
    <TreasuryScreen
      preloadedCoverage={preloadedCoverage}
      preloadedAggregates={preloadedAggregates}
    />
  );
}
