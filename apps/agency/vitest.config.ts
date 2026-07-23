import path from "node:path";
import { defineConfig } from "vitest/config";

// Two-environment setup driven by `vitest.environmentMatchGlobs`:
//   - convex/**/*.test.ts          → edge-runtime (convex-test requires it)
//   - src/**/*.test.ts(x)          → node (pure logic tests)
//
// Path aliases mirror tsconfig.json so tests can import `@/...` and `@convex/...`
// the same way production code does.
//
// `root` points at the monorepo root so vitest discovers both `apps/agency/**`
// tests AND the root-level `convex/**` tests in a single run.

const monorepoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  root: monorepoRoot,
  test: {
    // Default environment is `node`. Files needing `edge-runtime`
    // (convex-test in particular) opt in via a top-of-file annotation:
    //
    //   // @vitest-environment edge-runtime
    //
    // Some tests using `bun:test` stay on Bun's built-in runner and are excluded
    // from vitest discovery. Agency's own bun:test pricing was removed in #184;
    // the only remaining Bun-runner pricing test is apps/fund/src/lib/pricing,
    // excluded in fund's own config.
    //
    // The `src/lib/pricing/**` exclude is the historical (pre-monorepo) pattern,
    // kept verbatim so the local-only worktree failure mode
    // (.claude/worktrees/etherfuse-onramp/...) is preserved unchanged.
    // Scope discovery to apps/agency/** + convex/** so the apps/pay tree
    // (which has its own vitest config) doesn't get picked up twice.
    include: [
      "apps/agency/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "convex/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
    exclude: ["**/node_modules/**", "**/.next/**", "src/lib/pricing/**"],
    server: {
      deps: {
        inline: ["convex-test"],
      },
    },
  },
  resolve: {
    // Keep symlinks unresolved so convex-test's `import.meta.glob` (which
    // uses paths relative to its installed location at
    // `node_modules/convex-test/dist/index.js`) discovers `convex/_generated`
    // at the monorepo root. With symlinks resolved, the path lands inside
    // `node_modules/.bun/...` and the glob can't reach back out.
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(monorepoRoot, "apps/agency/src"),
      "@convex": path.resolve(monorepoRoot, "convex"),
    },
  },
});
