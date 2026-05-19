/**
 * Auth0 login route.
 *
 * TODO(auth0): install `@auth0/nextjs-auth0` then replace the stub body:
 *
 *   import { handleLogin } from "@auth0/nextjs-auth0";
 *   export const GET = handleLogin({
 *     returnTo: "/api/auth/callback",
 *   });
 *
 * The SDK reads AUTH0_ISSUER_BASE_URL, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET,
 * and AUTH0_SECRET from env vars (set via `bunx convex env set` for Convex
 * vars and `.env.local` for Next.js vars).
 */

import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/env";

// Stub: redirect to onboarding until Auth0 SDK is wired.
export function GET() {
  return NextResponse.redirect(new URL("/onboarding", getAppUrl()));
}
