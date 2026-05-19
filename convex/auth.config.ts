// Convex authentication configuration — Auth0 JWT provider.
//
// The `domain` must be your Auth0 issuer URL (AUTH0_ISSUER_BASE_URL env var),
// e.g. "https://your-tenant.auth0.com".
// The `applicationID` must match the `aud` claim in Auth0 tokens — typically
// your Convex deployment URL or a custom API identifier registered in Auth0.
//
// Required env vars (set via `bunx convex env set`) — both optional:
//   AUTH0_ISSUER_BASE_URL  — Auth0 tenant URL  (e.g. https://your.auth0.com)
//   AUTH0_CLIENT_ID        — Auth0 application client ID
//
// Env vars are read through lazy getters in `./lib/env` for consistency with
// the rest of the codebase, BUT Convex's auth.config.ts analyzer is special:
// it executes this file at deploy time and tracks env reads through call
// chains, so the lazy getter does NOT defeat the analyzer. Every deployment
// MUST set `AUTH0_ISSUER_BASE_URL` — empty string disables the provider, a
// real URL enables it. See .env.example for the `bunx convex env set` snippet.
//
// Client-side: configure `ConvexProviderWithAuth0` from `@auth0/nextjs-auth0`
// so the JWT is automatically attached to every Convex request.
// See: https://docs.convex.dev/auth/auth0

import { getAuth0ClientId, getAuth0IssuerBaseUrl } from "./lib/env";

const issuer = getAuth0IssuerBaseUrl();
const providers = issuer ? [{ domain: issuer, applicationID: getAuth0ClientId() ?? "" }] : [];

const authConfig = { providers };

export default authConfig;
