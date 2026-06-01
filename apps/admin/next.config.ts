import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Monorepo env-file shim: Next.js auto-loads .env.local from the project
// directory (here `apps/admin/`), but `convex dev` expects the same file at
// the monorepo root next to `convex/`. To keep one source of truth, read
// the root-level .env.local first and seed any keys that aren't yet present
// in process.env. Real environments (Vercel, CI) inject vars directly and
// this file simply doesn't exist, so the loop is a no-op.
const ROOT_ENV_FILE = resolve(__dirname, "../../.env.local");
if (existsSync(ROOT_ENV_FILE)) {
  const content = readFileSync(ROOT_ENV_FILE, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const isProd = process.env.NODE_ENV === "production";

// Content Security Policy — staff-only surface, no public embed. The
// allowance list is narrower than apps/agency on purpose:
//   - Convex websocket + HTTPS endpoints (read mutavStaff row, audit log)
//   - Auth0 tenant for the `mutavStaff` connection's Universal Login redirect
//     + token exchange (https://*.auth0.com, https://*.eu.auth0.com,
//     https://*.us.auth0.com — narrow to the chosen region in prod)
//   - Inline scripts (next-themes FOUC) + inline styles (Tailwind + shadcn)
// `frame-ancestors 'none'` is load-bearing — admin must never embed inside
// another origin (no agency-side Workspace context, no public iframe).
// `unsafe-eval` is dev-only; Turbopack/HMR needs it.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site https://*.auth0.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://*.auth0.com",
  "base-uri 'self'",
  "object-src 'none'",
  "worker-src 'self' blob:",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Workspace packages ship TypeScript / TSX source; Next.js must transpile
  // them through SWC on the way into the build.
  transpilePackages: ["@mutav/i18n", "@mutav/ui"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
