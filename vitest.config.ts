import path from "node:path";
import { defineConfig } from "vitest/config";

// Root vitest config — scoped to the Convex backend (convex/**).
//
// Why a root config on top of the per-app ones:
//
// - Every app (apps/agency, apps/admin, apps/pay, apps/fund) has its own
//   vitest.config.ts that ALSO includes convex/** in its glob. That lets
//   `turbo run test` (which invokes each app's `vitest run`) exercise the
//   convex tests once per app — a redundant but harmless safety net.
// - Without this root config, running `bunx vitest` from the repo root
//   uses no config at all. That skips the two settings convex-test needs
//   (`server.deps.inline` + `resolve.preserveSymlinks`) and fires an
//   `import.meta.glob is not a function` error inside convex-test's
//   moduleCache.
// - With this config, `bun run test:convex` at the root runs the Convex
//   suite exactly once, and `bunx vitest run convex/<domain>/foo.test.ts`
//   works from any directory.
//
// Keep the settings in sync with apps/*/vitest.config.ts. If a future
// package refactor removes convex/** from the app configs, this file
// becomes the sole source of truth for the Convex test runner.

const monorepoRoot = __dirname;

export default defineConfig({
  root: monorepoRoot,
  test: {
    // Default env is node; convex-test-using files opt into edge-runtime via
    //   // @vitest-environment edge-runtime
    // at the top of the file.
    include: ["convex/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    exclude: ["**/node_modules/**", "**/.next/**"],
    server: {
      // convex-test uses `import.meta.glob` internally; without inline
      // transform the raw CJS bundle escapes Vite's rewriter and throws
      // "(intermediate value).glob is not a function".
      deps: {
        inline: ["convex-test"],
      },
    },
  },
  resolve: {
    // convex-test resolves module paths relative to its installed location
    // (node_modules/convex-test/dist/index.js) and globs back out to
    // convex/_generated. With symlinks resolved, that install path lands
    // inside node_modules/.bun/... and the glob can't reach the schema.
    preserveSymlinks: true,
    alias: {
      "@convex": path.resolve(monorepoRoot, "convex"),
    },
  },
});
