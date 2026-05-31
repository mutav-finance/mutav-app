import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirror of apps/agency/vitest.config.ts shape but scoped to apps/pay.
// `root` stays at the monorepo root so the same convex/** tests would be
// discoverable from either app — that duplication is fine until packages
// extract (PR 6). The Bun-runner exclude (apps/agency/src/lib/pricing/**)
// stays here too because vitest's filter is repo-wide; if it weren't,
// running pay's vitest would pick up agency's pricing tests via root.

const monorepoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: monorepoRoot,
  test: {
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "src/lib/pricing/**",
      "apps/agency/src/lib/pricing/**",
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
