"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getConvexUrl } from "@/lib/env";

const url = getConvexUrl();
const convex = url ? new ConvexReactClient(url) : null;

/**
 * Top-level Convex provider for apps/admin. Bare unauthenticated variant
 * for now — staff identity lives in the Auth0 session cookie, and the
 * Auth0-to-Convex bridge (used by apps/agency via the `useAuthFromAuth0`
 * hook + `/api/auth/convex-token` route) is **not** mirrored here yet
 * because the `mutavStaff` Convex domain doesn't exist (A1 milestone).
 *
 * When A1 lands and Convex starts gating queries on a `mutavStaff` row
 * keyed off the Auth0 `sub` claim, this provider gains a
 * `ConvexProviderWithAuth` variant identical to agency's, but pointing at
 * a `/api/auth/convex-token` route in apps/admin.
 *
 * If `NEXT_PUBLIC_CONVEX_URL` is unset (preview deployments still being
 * provisioned), render the children without a provider; pages calling
 * Convex queries will throw at runtime.
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
