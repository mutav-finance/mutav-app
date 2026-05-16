/**
 * SEP-10: Web Authentication
 *
 * Implements the Stellar web authentication protocol for obtaining JWT tokens.
 * https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 *
 * Challenge validation delegates to `WebAuth.readChallengeTx` from the SDK,
 * which verifies the server's signature, the home-domain manage_data op, the
 * web_auth_domain op, sequence number, time bounds, and operation count. Don't
 * hand-roll this — the SDK function is the security boundary.
 */

import { WebAuth } from "@stellar/stellar-sdk";

import type {
  Sep10ChallengeResponse,
  Sep10TokenResponse,
  Sep10JwtPayload,
  SepError,
} from "./types";
import { SepApiError } from "./types";

export interface Sep10Config {
  /** Anchor's SEP-10 auth endpoint, e.g. https://anchor.example.com/auth */
  authEndpoint: string;
  /** Anchor's signing key from stellar.toml (G...) */
  serverSigningKey: string;
  /** Stellar network passphrase, e.g. Networks.TESTNET or Networks.PUBLIC */
  networkPassphrase: string;
  /** Anchor's home domain, e.g. anchor.example.com */
  homeDomain: string;
  /**
   * Domain of the auth server. Defaults to the host of `authEndpoint`.
   * Only override if the anchor serves auth from a different host than the
   * one declared in `web_auth_domain` on the challenge.
   */
  webAuthDomain?: string;
}

export interface Sep10SignerFn {
  (transactionXdr: string, networkPassphrase: string): Promise<string>;
}

/**
 * Request a challenge transaction from the anchor's auth server.
 */
export async function getChallenge(
  config: Sep10Config,
  account: string,
  options?: {
    memo?: string;
    clientDomain?: string;
  },
  fetchFn: typeof fetch = fetch,
): Promise<Sep10ChallengeResponse> {
  const url = new URL(config.authEndpoint);
  url.searchParams.set("account", account);
  url.searchParams.set("home_domain", config.homeDomain);

  if (options?.memo) {
    url.searchParams.set("memo", options.memo);
  }
  if (options?.clientDomain) {
    url.searchParams.set("client_domain", options.clientDomain);
  }

  const response = await fetchFn(url.toString());

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as SepError;
    throw new SepApiError(
      errorBody.error || `Failed to get challenge: ${response.status}`,
      response.status,
      errorBody,
    );
  }

  return response.json();
}

/**
 * Validates a challenge transaction received from the anchor.
 *
 * Delegates to `WebAuth.readChallengeTx`, which verifies the server's
 * signature and all SEP-10 invariants. Throws `SepApiError` on any failure
 * so callers can `catch` by type. Returns the client account ID parsed from
 * the challenge — use it to assert the server didn't substitute a different
 * account than the one we asked to authenticate.
 */
export function validateChallenge(
  challengeXdr: string,
  config: Sep10Config,
  expectedClientAccount: string,
): { clientAccountID: string; matchedHomeDomain: string; memo: string | null } {
  const webAuthDomain = config.webAuthDomain ?? new URL(config.authEndpoint).host;

  let result: ReturnType<typeof WebAuth.readChallengeTx>;
  try {
    result = WebAuth.readChallengeTx(
      challengeXdr,
      config.serverSigningKey,
      config.networkPassphrase,
      config.homeDomain,
      webAuthDomain,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SepApiError(`Invalid SEP-10 challenge: ${message}`, 0);
  }

  if (result.clientAccountID !== expectedClientAccount) {
    throw new SepApiError(
      `Challenge clientAccountID ${result.clientAccountID} does not match expected ${expectedClientAccount}`,
      0,
    );
  }

  return result;
}

/**
 * Submits a signed challenge transaction to get a JWT token.
 */
export async function submitChallenge(
  authEndpoint: string,
  signedTransactionXdr: string,
  fetchFn: typeof fetch = fetch,
): Promise<Sep10TokenResponse> {
  const response = await fetchFn(authEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedTransactionXdr }),
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as SepError;
    throw new SepApiError(
      errorBody.error || `Failed to submit challenge: ${response.status}`,
      response.status,
      errorBody,
    );
  }

  return response.json();
}

/**
 * Performs the full SEP-10 authentication flow:
 * 1. Get challenge from server
 * 2. Validate challenge (server signature + all invariants)
 * 3. Sign challenge with the provided signer
 * 4. Submit signed challenge, return JWT
 *
 * Validation is non-negotiable. The `signer` (Freighter, smart account, etc.)
 * only sees XDR — it trusts us to ensure the challenge is from the real
 * anchor. Skipping validation = wallet-draining vector.
 */
export async function authenticate(
  config: Sep10Config,
  account: string,
  signer: Sep10SignerFn,
  options?: {
    memo?: string;
    clientDomain?: string;
  },
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const challenge = await getChallenge(config, account, options, fetchFn);

  const networkPassphrase = challenge.network_passphrase || config.networkPassphrase;
  validateChallenge(challenge.transaction, { ...config, networkPassphrase }, account);

  const signedXdr = await signer(challenge.transaction, networkPassphrase);
  const tokenResponse = await submitChallenge(config.authEndpoint, signedXdr, fetchFn);

  return tokenResponse.token;
}

function base64UrlDecode(input: string): string {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

/**
 * Decodes a JWT token to extract the payload.
 *
 * Does NOT verify the signature — that's the anchor's job server-side.
 * Throws if the token shape is invalid; callers must handle.
 */
export function decodeToken(token: string): Sep10JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT token format");
  }
  return JSON.parse(base64UrlDecode(parts[1]));
}

/**
 * Checks if a JWT token is expired.
 *
 * Returns `true` for malformed tokens too — a token we can't read is, for
 * our purposes, unusable. Caller should treat this as "re-authenticate".
 */
export function isTokenExpired(token: string, bufferSeconds: number = 60): boolean {
  let payload: Sep10JwtPayload;
  try {
    payload = decodeToken(token);
  } catch {
    return true;
  }
  if (typeof payload.exp !== "number") return true;
  const now = Math.floor(Date.now() / 1000);
  return payload.exp < now + bufferSeconds;
}

/**
 * Creates authorization headers for SEP API requests.
 */
export function createAuthHeaders(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
