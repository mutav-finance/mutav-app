"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getConvexUrl } from "@/lib/env";

const url = getConvexUrl();
const convex = url ? new ConvexReactClient(url) : null;

/**
 * Top-level Convex provider for apps/fund. Fund carries no Auth0 (spec
 * § Section 1 load-bearing constraint), and the wallet-as-identity layer
 * is deferred to the wallet-kit selection spec — so this is the bare
 * unauthenticated variant for now. The Convex queries fund will consume
 * (NAV, fund metadata, partner whitelist) are read-only public data;
 * write-side actions will wallet-sign at the chain boundary, not at the
 * Convex boundary.
 *
 * If `NEXT_PUBLIC_CONVEX_URL` is unset (preview deployments still being
 * provisioned), render the children without a provider; pages calling
 * Convex queries will throw at runtime.
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
