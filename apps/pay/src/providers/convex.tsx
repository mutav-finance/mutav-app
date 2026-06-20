"use client";

import { ConvexPublicProvider } from "@mutav/app-shell/convex-public-provider";
import { getConvexUrl } from "@/lib/env";

/**
 * Pay's Convex provider — the shared unauthenticated bridge from
 * `@mutav/app-shell`, fed this app's env. The queries pay consumes
 * (`api.invoices.useCases.getPublicByPublicId`) are intentionally public —
 * gated only on the `publicId` URL bearer, never on a session.
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return <ConvexPublicProvider convexUrl={getConvexUrl()}>{children}</ConvexPublicProvider>;
}
