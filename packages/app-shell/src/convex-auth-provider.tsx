"use client";

import { useUser } from "@auth0/nextjs-auth0";
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useMemo } from "react";

/**
 * Bridges Auth0's session cookie to the Convex client. Convex calls
 * `fetchAccessToken` whenever it needs to refresh its bearer credential;
 * we hit a server-side route (`/api/auth/convex-token`) that reads the
 * encrypted session cookie and returns the Auth0 ID token. The Convex
 * deployment trusts that ID token because `auth.config.ts` registers
 * the same Auth0 tenant + client ID as the JWT issuer.
 *
 * `forceRefreshToken: true` is passed by Convex when the previous token
 * was rejected (typically 401 on a Convex request). The route handler
 * itself doesn't cache, so the cache hint mostly matters when the
 * browser's HTTP cache might otherwise serve a stale response.
 */
function useAuthFromAuth0() {
  const { user, isLoading } = useUser();

  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
      try {
        const response = await fetch("/api/auth/convex-token", {
          cache: forceRefreshToken ? "no-store" : "default",
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { token?: string };
        return data.token ?? null;
      } catch {
        return null;
      }
    },
    [],
  );

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
