import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirror of apps/pay/vitest.config.ts shape but scoped to apps/fund.
// `root` stays at the monorepo root so the same convex/** tests would be
// discoverable from any app — that duplication is fine until packages
// extract (PR 6). The Bun-runner exclude (apps/*/src/lib/pricing/**)
// stays here too because vitest's filter is repo-wide; if it weren't,
// running fund's vitest would pick up agency's pricing tests via root.

const monorepoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: monorepoRoot,
  test: {
    // Scope discovery to apps/fund/** + convex/** so the apps/agency and
    // apps/pay trees (each with their own vitest config) don't get
    // picked up here. Without this, sibling tests would try to resolve
    // `@/...` through fund's alias and fail. apps/agency and apps/pay
    // both run convex/** independently — duplication is intentional
    // until packages extract (PR 6).
    include: [
      "apps/fund/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "convex/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      // Same worktree exclude as apps/agency / apps/pay — historical
      // local-only failure unrelated to this PR.
      "src/lib/pricing/**",
      "apps/agency/src/lib/pricing/**",
      "apps/pay/src/lib/pricing/**",
      "apps/fund/src/lib/pricing/**",
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
      "@": path.resolve(monorepoRoot, "apps/fund/src"),
      "@convex": path.resolve(monorepoRoot, "convex"),
    },
  },
});
