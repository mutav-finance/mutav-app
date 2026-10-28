"use client";

import { useUser } from "@auth0/nextjs-auth0";
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useMemo } from "react";
import { fetchConvexToken } from "./convex-token-fetch";

/**
 * Bridges Auth0's session cookie to the Convex client. Convex calls
 * `fetchAccessToken` whenever it needs to refresh its bearer credential;
 * we hit a server-side route (`/api/auth/convex-token`) that reads the
 * encrypted session cookie and returns the Auth0 ID token. The Convex
 * deployment trusts that ID token because `auth.config.ts` registers
 * the same Auth0 tenant + client ID as the JWT issuer.
 *
 * Always `no-store`: a cached response would hand Convex a token the route
 * has since refreshed, so Convex's `forceRefreshToken` hint is not needed.
 */
function useAuthFromAuth0() {
  const { user, isLoading } = useUser();

  const fetchAccessToken = useCallback(() => fetchConvexToken(), []);

  return useMemo(
    () => ({
      isLoading,
      isAuthenticated: !!user,
      fetchAccessToken,
    }),
    [isLoading, user, fetchAccessToken],
  );
}

/**
 * Top-level Convex provider for an Auth0-backed persona app (admin, agency).
 * Two-mode, both branches build-time-stable so the component tree shape never
 * shifts within a single deployment (no runtime hook-order issues):
 *
 * - **Auth0 configured** (`auth0Domain` set): wraps with
 *   `ConvexProviderWithAuth` and pipes the Auth0 ID token through the
 *   `useAuthFromAuth0` hook above. The Convex backend verifies the JWT per
 *   `convex/auth.config.ts`.
 * - **Auth0 unconfigured** (preview deployments without Auth0 envs): plain
 *   `ConvexProvider`. The Convex backend sees no JWT and every wrapped handler
 *   throws `UnauthenticatedError`.
 *
 * `convexUrl` / `auth0Domain` are read from each app's `lib/env` getters and
 * passed in — the package never touches `process.env` (repo boundary rule). A
 * null `convexUrl` (env still being provisioned) renders children without a
 * provider; pages calling Convex queries throw at runtime.
 */
export function ConvexAuthProvider({
  convexUrl,
  auth0Domain,
  children,
}: {
  convexUrl: string | null;
  auth0Domain: string | null;
  children: React.ReactNode;
}) {
  const convex = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), [convexUrl]);

  if (!convex) return <>{children}</>;

  if (!auth0Domain) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuth0}>
      {children}
    </ConvexProviderWithAuth>
  );
}
