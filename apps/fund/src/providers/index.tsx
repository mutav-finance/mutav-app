"use client";

import { ConvexClientProvider } from "./convex";

/**
 * Provider tree for apps/fund. Intentionally minimal: just Convex.
 * - NO Auth0 wrapper (spec § Section 1 load-bearing constraint).
 * - NO WorkspaceContext (agency-only — fund has no agency scoping).
 * - NO wallet provider yet (blocked on the wallet-kit selection spec,
 *   per spec § Section 2 PR 4).
 *
 * The TooltipProvider that apps/pay carries is omitted here because the
 * empty shell ships no shadcn primitives. When the wallet-kit spec lands
 * and real UI follows, re-introduce it alongside whatever providers the
 * chosen wallet kit requires.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <ConvexClientProvider>{children}</ConvexClientProvider>;
}
