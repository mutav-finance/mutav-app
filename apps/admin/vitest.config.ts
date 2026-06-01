import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirror of apps/fund/vitest.config.ts shape but scoped to apps/admin.
// `root` stays at the monorepo root so the same convex/** tests would be
// discoverable from any app — that duplication is fine because each app
// runs its own vitest, and convex/** is shared. The Bun-runner exclude
// (apps/*/src/lib/pricing/**) stays here too because vitest's filter is
// repo-wide; if it weren't, running admin's vitest would pick up the
// agency / pay / fund pricing tests via the root.

const monorepoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: monorepoRoot,
  test: {
    // Scope discovery to apps/admin/** + convex/** so the apps/agency,
    // apps/pay, and apps/fund trees (each with their own vitest config)
    // don't get picked up here. Without this, sibling tests would try
    // to resolve `@/...` through admin's alias and fail.
    include: [
      "apps/admin/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "convex/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      // Same worktree exclude as apps/agency / apps/pay / apps/fund —
      // historical local-only failure unrelated to this PR.
      "src/lib/pricing/**",
      "apps/agency/src/lib/pricing/**",
      "apps/pay/src/lib/pricing/**",
      "apps/fund/src/lib/pricing/**",
      "apps/admin/src/lib/pricing/**",
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
      "@": path.resolve(monorepoRoot, "apps/admin/src"),
      "@convex": path.resolve(monorepoRoot, "convex"),
    },
  },
});
