/**
 * Auth0 logout route.
 *
 * TODO(auth0): install `@auth0/nextjs-auth0` then replace the stub body:
 *
 *   import { handleLogout } from "@auth0/nextjs-auth0";
 *   export const GET = handleLogout({
 *     returnTo: "/onboarding",
 *   });
 */

import { NextResponse } from "next/server";

// Stub: redirect to onboarding until Auth0 SDK is wired.
export function GET() {
  return NextResponse.redirect(
    new URL("/onboarding", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  );
}
