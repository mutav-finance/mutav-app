import { NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";

/**
 * Returns the current session's Auth0 ID token, which the Convex client
 * uses as the bearer credential. Called by the `useAuthFromAuth0` hook
 * in `src/providers/convex.tsx` whenever Convex asks for a fresh token.
 *
 * Why ID token instead of access token: Convex's `auth.config.ts`
 * registers `applicationID` = Auth0 client ID. JWT verification matches
 * the `aud` claim against that client ID; ID tokens carry the client ID
 * in `aud` by default, access tokens carry a separately-configured
 * audience that we'd have to set up in the Auth0 dashboard. The ID-token
 * path works out of the box without an Auth0 API resource registration.
 *
 * If we ever need access tokens (e.g. for an Auth0 Management API call),
 * we expose them via a different route — never mix the two on one
 * endpoint, because access tokens are higher-privilege and shouldn't
 * flow on the same channel as the Convex auth header.
 */
export async function GET() {
  const session = await auth0.getSession();
  if (!session) {
    return new NextResponse(null, { status: 401 });
  }

  const idToken = session.tokenSet.idToken;
  if (!idToken) {
    return new NextResponse(null, { status: 401 });
  }

  return NextResponse.json({ token: idToken });
}
