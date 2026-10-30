/**
 * Env getters for apps/admin. Only NEXT_PUBLIC_* vars exist in the browser
 * bundle; everything else returns undefined client-side. This is the only
 * file under src/ that's allowed to read `process.env` directly; see
 * CLAUDE.md.
 */

/**
 * Guard for URL vars whose dev fallback is a localhost origin. An unset
 * var used to fall through silently and ship `http://localhost:PORT` to
 * real users — a dead redirect that reads as an auth bug rather than the
 * config bug it is. Fail loud instead, as `getStellarRpcUrl` below does.
 *
 * `NEXT_PUBLIC_*` reads are inlined at build time, so an unset var fails
 * the production build instead of waiting for a user to hit the route.
 * Dev and preview keep the port fallback, so local dev needs no `.env`.
 */
export function requireUrlInProduction(
  value: string | undefined,
  varName: string,
  devFallback: string,
): string {
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${varName} must be set in production — refusing to fall back to ${devFallback}`,
    );
  }
  return devFallback;
}

export function getAppUrl(): string {
  return requireUrlInProduction(
    process.env.NEXT_PUBLIC_APP_URL,
    "NEXT_PUBLIC_APP_URL",
    "http://localhost:3003",
  );
}

export function getAppBaseUrl(): string {
  return requireUrlInProduction(process.env.APP_BASE_URL, "APP_BASE_URL", "http://localhost:3003");
}

const ID_TOKEN_REFRESH_WINDOW_SECONDS_DEFAULT = 600;
const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * How long before the ID token's `exp` the proxy and the Convex token route
 * refresh it. Server-only. Anything but a positive integer falls back to the
 * default, so a typo can't turn refresh off or make it run on every request.
 */
export function getIdTokenRefreshWindowSeconds(): number {
  const raw = process.env.AUTH0_ID_TOKEN_REFRESH_WINDOW_SECONDS;
  if (!raw) return ID_TOKEN_REFRESH_WINDOW_SECONDS_DEFAULT;
  if (!POSITIVE_INTEGER.test(raw)) {
    warnInvalidRefreshWindowOnce();
    return ID_TOKEN_REFRESH_WINDOW_SECONDS_DEFAULT;
  }
  return Number(raw);
}

let invalidRefreshWindowWarned = false;

/** Once per process: the getter runs on every proxied request. Names the var, never its value. */
function warnInvalidRefreshWindowOnce(): void {
  if (invalidRefreshWindowWarned) return;
  invalidRefreshWindowWarned = true;
  console.warn(
    `[env] AUTH0_ID_TOKEN_REFRESH_WINDOW_SECONDS is not a positive integer; using ${ID_TOKEN_REFRESH_WINDOW_SECONDS_DEFAULT}`,
  );
}

export function getConvexUrl(): string | null {
  return process.env.NEXT_PUBLIC_CONVEX_URL ?? null;
}

export function getAuth0Domain(): string | null {
  return process.env.NEXT_PUBLIC_AUTH0_DOMAIN ?? null;
}

/**
 * Public URL of the agency app (`app.mutav.finance`). The admin staff gate
 * bounces an authenticated-but-not-staff user here (cross-app, cross-origin)
 * rather than looping them back to Universal Login. Falls back to the agency
 * dev port (3000) for local dev. Production sets
 * `NEXT_PUBLIC_AGENCY_URL=https://app.mutav.finance`.
 */
export function getAgencyUrl(): string {
  return requireUrlInProduction(
    process.env.NEXT_PUBLIC_AGENCY_URL,
    "NEXT_PUBLIC_AGENCY_URL",
    "http://localhost:3000",
  );
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
 * Soroban RPC URL. Testnet defaults to the public RPC (which the `next.config`
 * CSP `connect-src` allows). There is no public mainnet RPC — and a provider
 * host would be blocked by the CSP unless added there — so mainnet REQUIRES
 * `NEXT_PUBLIC_STELLAR_RPC_URL`. Shipping a CSP-blocked default would let a
 * privileged tx get signed and then fail to submit; fail loud at config instead.
 */
export function getStellarRpcUrl(): string {
  const override = process.env.NEXT_PUBLIC_STELLAR_RPC_URL;
  if (override) return override;
  if (getStellarNetwork() === "public") {
    throw new Error(
      "NEXT_PUBLIC_STELLAR_RPC_URL must be set for the public network, and its host added to next.config CSP connect-src",
    );
  }
  return "https://soroban-testnet.stellar.org";
}

/** Network passphrase — a stable protocol constant derived from the network. */
export function getStellarNetworkPassphrase(): string {
  return getStellarNetwork() === "public"
    ? "Public Global Stellar Network ; September 2015"
    : "Test SDF Network ; September 2015";
}
