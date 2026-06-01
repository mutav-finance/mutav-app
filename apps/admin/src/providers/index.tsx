"use client";

import { Auth0Provider } from "@auth0/nextjs-auth0";
import { ConvexClientProvider } from "./convex";

/**
 * Provider tree for apps/admin.
 *
 * - **`Auth0Provider`** — client-side context that backs `useUser()` /
 *   `getAccessToken()` in client components. It does NOT set or read the
 *   Auth0 session cookie itself; the singleton `Auth0Client` (constructed
 *   in `src/lib/auth0.ts`, invoked via the proxy middleware) owns the
 *   server-side session lifecycle. The provider exists so client islands
 *   under `(admin)` can show "signed in as …" affordances or read the
 *   user's profile without a server round-trip.
 * - **`ConvexClientProvider`** — bare unauthenticated Convex client (see
 *   `./convex.tsx` for the A1 upgrade path).
 *
 * The TooltipProvider that apps/agency wraps under WorkspaceProvider is
 * omitted here because the empty shell ships no shadcn primitives yet.
 * Reintroduce it alongside whichever interactive surfaces A1–A6 bring in.
 *
 * `NextIntlClientProvider` is mounted in the root `[locale]/layout.tsx`
 * rather than here, because it needs the per-request locale from
 * `setRequestLocale` and that's resolved at the page boundary.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider>
      <ConvexClientProvider>{children}</ConvexClientProvider>
    </Auth0Provider>
  );
}
