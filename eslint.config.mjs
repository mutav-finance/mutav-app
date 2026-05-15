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
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Auto-generated Convex types — they ship their own eslint-disable
      // headers; ESLint flags those headers as "unused" since the rules
      // they disable aren't active here.
      "convex/_generated/**",
      // Local agent tooling — not project source.
      ".claude/**",
      ".agents/**",
      // Vendored anchor SDK from github.com/ElliotFriend/regional-starter-pack.
      // Kept verbatim so we can pull upstream updates with a clean diff.
      "src/lib/anchors/**",
      // Operator-run sandbox smoke test — vendored shape, not production code.
      "scripts/etherfuse-smoke.ts",
    ],
  },
  ...nextVitals,
  ...nextTs,
]);

export default eslintConfig;
