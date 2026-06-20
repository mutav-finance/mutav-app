"use client";

import { ConvexPublicProvider } from "@mutav/app-shell/convex-public-provider";
import { getConvexUrl } from "@/lib/env";

/**
 * Fund's Convex provider — the shared unauthenticated bridge from
 * `@mutav/app-shell`, fed this app's env. Fund carries no Auth0 (spec
 * § Section 1 load-bearing constraint), and the wallet-as-identity layer is
 * deferred to the wallet-kit selection spec. The Convex queries fund consumes
 * (NAV, fund metadata, partner whitelist) are read-only public data;
 * write-side actions wallet-sign at the chain boundary, not at Convex.
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return <ConvexPublicProvider convexUrl={getConvexUrl()}>{children}</ConvexPublicProvider>;
}
