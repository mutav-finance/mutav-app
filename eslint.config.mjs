import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // Ignore patterns must be in their own object to take effect globally
  // across the flat config. eslint-config-next defaults are repeated here
  // because we're overriding the bundle's own ignore list.
  {
    ignores: [
      // eslint-config-next defaults
      "**/.next/**",
      "out/**",
      "build/**",
      "**/next-env.d.ts",
      // Auto-generated Convex types — they ship their own eslint-disable
      // headers; ESLint flags those headers as "unused" since the rules
      // they disable aren't active here.
      "convex/_generated/**",
      // Local agent tooling — not project source.
      ".claude/**",
      ".agents/**",
      // Vendored Etherfuse client — kept verbatim from regional-starter-pack
      // so upstream pulls stay clean-diff. Same for the operator-run sandbox
      // smoke test (vendored shape, not production code). The same client is
      // duplicated under apps/pay during the PR 3 split; both copies stay
      // vendored verbatim until packages extraction (PR 6).
      "apps/agency/src/lib/anchors/etherfuse/**",
      "apps/pay/src/lib/anchors/etherfuse/**",
      "scripts/etherfuse-smoke.ts",
    ],
  },
  // Tell the Next.js eslint plugin where the Next apps live so its
  // pages/app-dir discovery (and rules like no-html-link-for-pages) work
  // post-monorepo move. Without this the plugin probes `<cwd>/pages` and
  // emits a "Pages directory cannot be found" warning when lint runs from
  // a per-app directory. The plugin accepts an array of rootDirs.
  {
    settings: {
      next: {
        rootDir: ["apps/agency", "apps/pay", "apps/fund"],
      },
    },
  },
  ...nextVitals,
  ...nextTs,
]);

export default eslintConfig;
