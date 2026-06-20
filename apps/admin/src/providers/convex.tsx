"use client";

import { ConvexAuthProvider } from "@mutav/app-shell/convex-auth-provider";
import { getAuth0Domain, getConvexUrl } from "@/lib/env";

/**
 * Admin's Convex provider — the shared Auth0-backed bridge from
 * `@mutav/app-shell`, fed this app's env. All the token-refresh logic lives
 * in the package; this wrapper only injects the env values (so `process.env`
 * stays behind `lib/env`, per the repo boundary rule).
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthProvider convexUrl={getConvexUrl()} auth0Domain={getAuth0Domain()}>
      {children}
    </ConvexAuthProvider>
  );
}
