import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const REPO_ROOT = fileURLToPath(new URL(".", import.meta.url));

// Absolute, and read from disk rather than listed: `bun run lint` runs from
// `apps/<app>/` under turbo, where repo-relative rootDirs resolve to nothing —
// the Next plugin then reports "Pages directory cannot be found" and silently
// disables the rules that need it. A hardcoded list also means a fifth app
// lints without the Next rules at all.
const NEXT_APP_ROOTS = readdirSync(join(REPO_ROOT, "apps"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(REPO_ROOT, "apps", entry.name));

/**
 * Files Next mounts as segment-level chrome: `layout.tsx` and `template.tsx`
 * wrap `children`, `default.tsx` stands in for an unmatched parallel slot.
 * All three can host a header/nav a page cannot.
 */
const ROUTE_WRAPPER_GLOB = "apps/*/src/app/**/{layout,template,default}.tsx";

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
      // Standalone Stellar/Etherfuse learning lab — self-contained (own
      // package.json + tsconfig, run with its own `bun install`). Dev tooling
      // and reference scripts, not project source, so app conventions and the
      // strict lint gate don't apply.
      "labs/**",
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
  // post-monorepo move. The plugin accepts an array of rootDir globs.
  {
    settings: {
      next: {
        rootDir: NEXT_APP_ROOTS,
      },
    },
  },
  ...nextVitals,
  ...nextTs,
  // ── Shell contract (docs/architecture/nav-shell-audit.md § 4) ──
  //
  // Route files must not hand-roll chrome. After the shell migration the only
  // way to do so is to import an ingredient a shell already composes, which
  // makes the rule a specifier ban rather than a JSX walk. Fast feedback in
  // the editor and in `.husky/pre-commit`; tests/shell-contract.test.ts is the
  // merge gate and the only check that can see a MISSING shell.
  //
  // Scoped to `src/app/**` (route files) on purpose: app-local nav components
  // under `src/components/**` legitimately import the sidebar primitives.
  {
    files: ["apps/*/src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@mutav/ui/sidebar",
              message:
                "Sidebar chrome is composed by @mutav/ui/shell/app-shell. Pass sidebarHeader/nav/identity as slots.",
            },
            {
              name: "@mutav/ui/public/public-shell",
              message: "Use @mutav/ui/shell/flow-shell or @mutav/ui/shell/bare-shell.",
            },
            { name: "@mutav/ui/sonner", message: "The shells own the Toaster." },
          ],
        },
      ],
    },
  },
  // Inline chrome only. Extracting the same markup into a `src/components/`
  // file defeats a one-file-at-a-time linter by construction, so
  // tests/shell-contract.test.ts follows the wrapper's local imports one hop
  // and re-checks them there.
  {
    files: [ROUTE_WRAPPER_GLOB],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: 'JSXOpeningElement[name.name="header"]',
          message: "Route wrappers do not hand-roll chrome — use a shell from @mutav/ui/shell/*.",
        },
        {
          selector: 'JSXOpeningElement[name.name="nav"]',
          message: "Route wrappers do not hand-roll chrome — use a shell from @mutav/ui/shell/*.",
        },
        {
          selector: 'JSXOpeningElement[name.name="aside"]',
          message: "Route wrappers do not hand-roll chrome — use a shell from @mutav/ui/shell/*.",
        },
        {
          selector: 'JSXOpeningElement[name.name="footer"]',
          message: "Route wrappers do not hand-roll chrome — use a shell from @mutav/ui/shell/*.",
        },
      ],
    },
  },
  {
    // Convex ships everything written to `console.*` to the function log, which
    // is US-hosted and outside any retention policy, so a raw console call is
    // an uninstrumentable disclosure.
    //
    // This replaces enumerating PII field names and call shapes in a grep. That
    // approach could not see `console.log(JSON.stringify(row))` — the single
    // most common way to dump a document — because any function-call wrapper
    // defeated the pattern, and its field list silently missed `cep`,
    // `address` and bare `name`. "console exists in exactly one file" is a
    // bounded invariant a parser can enforce; "no PII in any argument shape"
    // is not.
    files: ["convex/**/*.ts"],
    ignores: ["convex/_generated/**", "convex/lib/logger.ts", "convex/**/*.test.ts"],
    rules: {
      "no-console": "error",
    },
  },
]);

export default eslintConfig;
