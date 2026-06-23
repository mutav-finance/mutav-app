/**
 * Env getters for apps/admin. Only NEXT_PUBLIC_* vars exist in the browser
 * bundle; everything else returns undefined client-side. This is the only
 * file under src/ that's allowed to read `process.env` directly; see
 * CLAUDE.md.
 *
 * Admin is the staff surface and DOES carry Auth0 — against the separate
 * `mutavStaff` connection (spec § Section 7), which is administratively
 * distinct from the agency-staff connection consumed by apps/agency. The
 * `AUTH0_CONNECTION` getter exposes the connection name so the Auth0
 * client can route Universal Login to the mutavStaff flow directly,
 * bypassing the customer-facing picker.
 */

/**
 * App public URL — used by server-side handlers when constructing
 * absolute redirect URLs. Falls back to localhost:3003 for dev (apps/admin
 * runs on a distinct port from agency:3000, pay:3001, fund:3002 to allow
 * side-by-side local development). Production sets `NEXT_PUBLIC_APP_URL`.
 */
export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3003";
}

/**
 * Server-only base URL used by the Auth0 SDK + our `onCallback` redirect
 * construction. `APP_BASE_URL` is the canonical name the Auth0 v4 SDK
 * reads itself; we mirror the agency convention so cookie scope and
 * callback URLs line up. Returns `undefined` in the browser bundle.
 */
export function getAppBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3003";
}

/**
 * Convex deployment URL. Public because the browser bundle needs it to
 * construct the `ConvexReactClient`. Returns null when unset so callers
 * can degrade gracefully (e.g. render without Convex provider).
 *
 * Admin and agency share a single Convex deployment (spec § Section 1
 * load-bearing constraint — the hash-chained audit log requires a
 * single writer). Both apps set the same value.
 */
export function getConvexUrl(): string | null {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
}

/**
 * Public Auth0 tenant domain, exposed so the Convex provider could decide
 * whether to wrap with `ConvexProviderWithAuth` once the Auth0 → Convex
 * bridge lands for admin (separate milestone — Convex still reads staff
 * identity via a `mutavStaff` row keyed off the Auth0 `sub` claim).
 * Returns null when unset.
 */
export function getAuth0Domain(): string | null {
  return process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? null;
}

/**
 * The Auth0 connection name to use on Universal Login. For admin this is
 * the separate `mutavStaff` connection per spec § Section 7 — mandatory
 * MFA, IP allowlist, disabled self-signup. The connection itself is
 * provisioned in the Auth0 dashboard (downstream ops step); this code
 * just routes login to it.
 *
 * Falls back to `"mutavStaff"` so the scaffold compiles even before the
 * env var is wired in Vercel; the agency-side Auth0 connection is never
 * a valid value here.
 */
export function getAuth0Connection(): string {
  return process.env.AUTH0_CONNECTION ?? "mutavStaff";
}

/**
 * Public URL of the agency app (`app.mutav.finance`). The admin staff gate
 * bounces an authenticated-but-not-staff user here (cross-app, cross-origin
 * — Phase D) rather than looping them back to Universal Login. Falls back
 * to the agency dev port (3000) for local dev. Production sets
 * `NEXT_PUBLIC_AGENCY_URL=https://app.mutav.finance`.
 */
export function getAgencyUrl(): string {
  return process.env.NEXT_PUBLIC_AGENCY_URL ?? "http://localhost:3000";
}

// ─── Stellar (wallet signing) ────────────────────────────────────────────────
//
// Config passed into `@mutav/wallet`'s WalletProvider (the package never reads
// env itself). Pilot runs on testnet; `set NEXT_PUBLIC_STELLAR_NETWORK=public`
// + a provider RPC URL when going mainnet.

/** Which Stellar network the admin signs against. Defaults to testnet. */
export function getStellarNetwork(): "testnet" | "public" {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? "public" : "testnet";
}

/**
 * Soroban RPC URL. Defaults to the public testnet RPC; mainnet must set
 * `NEXT_PUBLIC_STELLAR_RPC_URL` to a provider endpoint (no public mainnet RPC).
 */
export function getStellarRpcUrl(): string {
  const override = process.env.NEXT_PUBLIC_STELLAR_RPC_URL;
  if (override) return override;
  return getStellarNetwork() === "public"
    ? "https://mainnet.sorobanrpc.com"
    : "https://soroban-testnet.stellar.org";
}

/** Network passphrase — a stable protocol constant derived from the network. */
export function getStellarNetworkPassphrase(): string {
  return getStellarNetwork() === "public"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}
