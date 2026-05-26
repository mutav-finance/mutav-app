"use client";

import { useUser } from "@auth0/nextjs-auth0";
import { ConvexProvider, ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { useCallback, useMemo } from "react";
import { getAuth0Domain } from "@/lib/env";

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

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
 * Top-level Convex provider. Two-mode:
 *
 * - **Auth0 configured** (`NEXT_PUBLIC_AUTH0_DOMAIN` set): wraps with
 *   `ConvexProviderWithAuth` and pipes the Auth0 ID token through the
 *   `useAuthFromAuth0` hook above. The Convex backend verifies the JWT
 *   per `convex/auth.config.ts`.
 * - **Auth0 unconfigured** (preview deployments without Auth0 envs):
 *   plain `ConvexProvider`. The Convex backend sees no JWT and every
 *   wrapped handler throws `UnauthenticatedError`.
 *
 * The conditional is on a build-time env var, so the component tree
 * shape is stable within a single deployment. No runtime hook-order
 * issues.
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (!convex) return <>{children}</>;

  const auth0Domain = getAuth0Domain();
  if (!auth0Domain) {
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
  }

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useAuthFromAuth0}>
      {children}
    </ConvexProviderWithAuth>
  );
}
