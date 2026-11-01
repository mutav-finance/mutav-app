import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getFreshIdToken } from "@mutav/app-shell/fresh-id-token";
import { auth0 } from "@/lib/auth0";
import { getIdTokenRefreshWindowSeconds } from "@/lib/env";
import { getStaffMemberWith, type StaffGateResult } from "@/lib/staff-gate";

export type { StaffGateResult } from "@/lib/staff-gate";

/**
 * Server-side staff gate for App Router server components / layouts. Wires
 * the real Auth0 session and Convex reads into `getStaffMemberWith`, which
 * owns the classification (see `staff-gate.ts`).
 */
export function getStaffMember(): Promise<StaffGateResult> {
  return getStaffMemberWith({
    getSession: () => auth0.getSession(),
    // "never": a Server Component cannot persist a refreshed session cookie,
    // so the proxy refreshes ahead of expiry and this only reads what is there.
    readToken: () =>
      getFreshIdToken({
        auth0,
        refreshWindowSeconds: getIdTokenRefreshWindowSeconds(),
        refresh: "never",
      }),
    fetchStaff: (token) => fetchQuery(api.mutavStaff.useCases.getMyStaff, {}, { token }),
    log: (step, fields) => console.error(`[admin] staff gate ${step} failed`, fields),
  });
}
