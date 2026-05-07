// Convex authentication config.
//
// No JWT provider is wired yet — the providers array is intentionally empty.
// Every Convex function in this app must therefore treat
// `ctx.auth.getUserIdentity()` as `null` and route through `requireIdentity`
// in `convex/lib/auth.ts`, which fails closed when auth is unconfigured.
//
// To enable auth, add a provider entry pointing at the JWT issuer's
// `/.well-known/openid-configuration` URL — for example:
//
//   providers: [
//     { domain: "https://your-issuer.example.com", applicationID: "convex" },
//   ],
//
// See the Convex auth guidelines (convex/_generated/ai/guidelines.md) and
// https://docs.convex.dev/auth for provider setup.

export default {
  providers: [],
};
