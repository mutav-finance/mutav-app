/**
 * Auth0 post-login callback handler.
 *
 * Responsibilities:
 *   1. Complete the Auth0 authorization code exchange (via Auth0 SDK)
 *   2. Provision or link the user row in Convex (`getOrCreateByIdentity`)
 *   3. Query the user's onboarding state and redirect accordingly
 *
 * ─── Implementation guide (Auth0 SDK v3 / @auth0/nextjs-auth0) ───────────────
 *
 * Install:
 *   bun add @auth0/nextjs-auth0
 *
 * Required env vars (.env.local + Railway):
 *   AUTH0_ISSUER_BASE_URL   — e.g. https://your-tenant.auth0.com
 *   AUTH0_CLIENT_ID         — Auth0 application client ID
 *   AUTH0_CLIENT_SECRET     — Auth0 application client secret
 *   AUTH0_SECRET            — random 32+ char string for session encryption
 *   AUTH0_BASE_URL          — your app's public URL (e.g. https://app.mutav.com.br)
 *
 * Convex env vars (bunx convex env set):
 *   AUTH0_ISSUER_BASE_URL   — same as above
 *   AUTH0_CLIENT_ID         — same as above
 *
 * Create src/lib/auth0.ts:
 *   import { Auth0Client } from "@auth0/nextjs-auth0/server";
 *   export const auth0 = new Auth0Client();
 *
 * Replace the stub GET below with:
 *
 *   import { auth0 } from "@/lib/auth0";
 *   import { ConvexHttpClient } from "convex/browser";
 *   import { internal, api } from "@convex/_generated/api";
 *   import { ONBOARDING_STATE } from "@convex/agencies/domain";
 *
 *   const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
 *
 *   export const GET = auth0.handleCallback({
 *     async afterCallback(session) {
 *       // 1. Provision Convex user row on first login (idempotent).
 *       // Uses ConvexHttpClient with the Auth0 access token so the internal
 *       // mutation runs with proper authorization context.
 *       await convex.mutation(internal.users.useCases.getOrCreateByIdentity, {
 *         subject: session.user.sub,
 *         name:    session.user.name  ?? "",
 *         email:   session.user.email ?? "",
 *       });
 *
 *       // 2. Query the user's onboarding state.
 *       // setAuth attaches the JWT so queryWithAuth can resolve the user.
 *       convex.setAuth(session.tokenSet.accessToken);
 *       const status = await convex.query(api.agencies.useCases.getMyOnboardingStatus);
 *
 *       // 3. Store destination in session so the callback can redirect there.
 *       return { ...session, returnTo: resolveRedirect(status) };
 *     },
 *   });
 *
 *   function resolveRedirect(status: { state: string; rejectionReason: string | null }): string {
 *     switch (status.state) {
 *       case ONBOARDING_STATE.NOT_STARTED:  return "/onboarding";
 *       case ONBOARDING_STATE.IN_PROGRESS:  return "/onboarding/wizard";
 *       case ONBOARDING_STATE.SUBMITTED:    return "/onboarding/status?state=submitted";
 *       case ONBOARDING_STATE.UNDER_REVIEW: return "/onboarding/status?state=under_review";
 *       case ONBOARDING_STATE.ACTIVE:       return "/";
 *       case ONBOARDING_STATE.REJECTED: {
 *         const reason = status.rejectionReason
 *           ? `?reason=${encodeURIComponent(status.rejectionReason)}`
 *           : "";
 *         return `/onboarding/rejected${reason}`;
 *       }
 *       default: return "/onboarding";
 *     }
 *   }
 */

import { NextResponse } from "next/server";

// Stub: redirect to onboarding until Auth0 SDK is wired.
export function GET() {
  return NextResponse.redirect(
    new URL("/onboarding", process.env.AUTH0_BASE_URL ?? "http://localhost:3000"),
  );
}
