import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirror of apps/agency/vitest.config.ts shape but scoped to apps/pay.
// `root` stays at the monorepo root so the same convex/** tests would be
// discoverable from either app — that duplication is fine until packages
// extract (PR 6). The `src/lib/pricing/**` worktree exclude stays here
// because vitest's filter is repo-wide.

const monorepoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: monorepoRoot,
  test: {
    // Scope discovery to apps/pay/** + convex/** so the apps/agency tree
    // (which has its own vitest config) doesn't get picked up twice.
    // Without this, `apps/agency/src/components/onboarding/*.test.ts`
    // would try to resolve `@/components/onboarding/...` through pay's
    // alias and fail. apps/agency's vitest.config.ts has the same root,
    // so its full run still covers convex/**.
    include: [
      "apps/pay/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "convex/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      // Same worktree exclude as apps/agency — historical local-only failure
      // unrelated to this PR. See apps/agency/vitest.config.ts for the full
      // rationale.
      "src/lib/pricing/**",
    ],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(monorepoRoot, "apps/pay/src"),
      "@convex": path.resolve(monorepoRoot, "convex"),
    },
  },
});
