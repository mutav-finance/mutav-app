"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useMemo } from "react";

/**
 * Top-level Convex provider for a public, unauthenticated persona app
 * (fund, pay). These apps carry no Auth0 (spec § Section 1 load-bearing
 * constraint); the queries they consume are read-only public data and any
 * write-side actions wallet-sign at the chain boundary, not at the Convex
 * boundary.
 *
 * `convexUrl` is read from the app's `lib/env` getter and passed in — the
 * package never touches `process.env` (repo boundary rule). A null
 * `convexUrl` (preview env still being provisioned) renders children without
 * a provider; pages calling Convex queries throw at runtime.
 */
export function ConvexPublicProvider({
  convexUrl,
  children,
}: {
  convexUrl: string | null;
  children: React.ReactNode;
}) {
  const convex = useMemo(() => (convexUrl ? new ConvexReactClient(convexUrl) : null), [convexUrl]);

  if (!convex) return <>{children}</>;

  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
