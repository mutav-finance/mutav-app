/**
 * Auth0 post-login callback handler.
 *
 * Responsibilities once wired:
 *   1. Complete the Auth0 authorization code exchange (via Auth0 SDK)
 *   2. Provision or link the user row in Convex (`internal.users.useCases.getOrCreateByIdentity`)
 *   3. Query the user's onboarding state (`api.agencies.useCases.getMyOnboardingStatus`)
 *      and redirect per the route shape:
 *        not_started / null → /onboarding
 *        in_progress         → /onboarding/wizard
 *        submitted/under_review → /onboarding/status?state=...
 *        active              → /
 *        rejected            → /onboarding/rejected?reason=...
 *
 * TODO(auth0): wire @auth0/nextjs-auth0 here. The integration shape is
 * SDK-version-specific (afterCallback semantics changed between v3 and v4) —
 * verify against the SDK version installed, don't crib from prior pseudocode.
 * See docs/auth.md for the wrapper architecture and Convex callsites.
 */

import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/env";

// Stub: redirect to onboarding until Auth0 SDK is wired.
export function GET() {
  return NextResponse.redirect(new URL("/onboarding", getAppUrl()));
}
