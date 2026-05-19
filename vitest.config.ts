import path from "node:path";
import { defineConfig } from "vitest/config";

// Two-environment setup driven by `vitest.environmentMatchGlobs`:
//   - convex/**/*.test.ts          → edge-runtime (convex-test requires it)
//   - src/**/*.test.ts(x)          → node (pure logic tests)
//
// Path aliases mirror tsconfig.json so tests can import `@/...` and `@convex/...`
// the same way production code does.

export default defineConfig({
  test: {
    // Default environment is `node`. Files needing `edge-runtime`
    // (convex-test in particular) opt in via a top-of-file annotation:
    //
    //   // @vitest-environment edge-runtime
    //
    // Existing tests using `bun:test` (currently src/lib/pricing/*.test.ts)
    // stay on Bun's built-in runner and are excluded from vitest discovery.
    exclude: ["**/node_modules/**", "**/.next/**", "src/lib/pricing/**"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex": path.resolve(__dirname, "./convex"),
    },
  },
});
