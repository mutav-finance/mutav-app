"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { getConvexUrl } from "@/lib/env";

const url = getConvexUrl();
const convex = url ? new ConvexReactClient(url) : null;

/**
 * Top-level Convex provider for apps/pay. Pay carries no Auth0 (spec § Section 1
 * load-bearing constraint), so this is the unauthenticated single-mode
 * variant: a bare `ConvexProvider`. The Convex queries pay consumes
 * (`api.payments.useCases.getPublicByPublicId`) are intentionally public —
 * gated only on the `publicId` URL bearer, never on a session.
 *
 * If `NEXT_PUBLIC_CONVEX_URL` is unset (preview deployments still being
 * provisioned), render the children without a provider; pages calling
 * Convex queries will throw at runtime.
 */
export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
