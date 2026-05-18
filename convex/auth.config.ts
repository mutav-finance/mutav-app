// Convex authentication configuration — Auth0 JWT provider.
//
// The `domain` must be your Auth0 issuer URL (AUTH0_ISSUER_BASE_URL env var),
// e.g. "https://your-tenant.auth0.com".
// The `applicationID` must match the `aud` claim in Auth0 tokens — typically
// your Convex deployment URL or a custom API identifier registered in Auth0.
//
// Required env vars (set via `bunx convex env set`):
//   AUTH0_ISSUER_BASE_URL  — Auth0 tenant URL  (e.g. https://your.auth0.com)
//   AUTH0_CLIENT_ID        — Auth0 application client ID
//
// Client-side: configure `ConvexProviderWithAuth0` from `@auth0/nextjs-auth0`
// so the JWT is automatically attached to every Convex request.
// See: https://docs.convex.dev/auth/auth0

// Only activate the Auth0 provider when the env var is present.
// When absent (local dev without Auth0), providers stays empty and
// ctx.auth.getUserIdentity() always returns null — the dev-user fallback
// in convex/lib/auth.ts takes over transparently.
const providers = process.env.AUTH0_ISSUER_BASE_URL
  ? [
      {
        domain: process.env.AUTH0_ISSUER_BASE_URL,
        applicationID: process.env.AUTH0_CLIENT_ID ?? "",
      },
    ]
  : [];

const authConfig = { providers };

export default authConfig;
