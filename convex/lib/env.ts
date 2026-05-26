export function getResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  return key;
}

export function getResendFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) throw new Error("RESEND_FROM_EMAIL is not set");
  return from;
}

// Waitlist audience IDs are optional per audience — when an audience hasn't
// been provisioned in Resend yet, the action logs and skips. Returns null
// rather than throwing so the surrounding mutation succeeds regardless.
export function getWaitlistAudienceId(audience: "investidor" | "imobiliaria"): string | null {
  const key =
    audience === "investidor" ? "RESEND_INVESTIDOR_AUDIENCE_ID" : "RESEND_IMOBILIARIA_AUDIENCE_ID";
  return process.env[key] ?? null;
}

export function getAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error("APP_URL is not set");
  return url;
}

export function getWhatsAppApiUrl(): string | null {
  return process.env.WHATSAPP_API_URL ?? null;
}

export function getWhatsAppApiKey(): string | null {
  return process.env.WHATSAPP_API_KEY ?? null;
}

/**
 * Dev-only fallback. Production must set `STELLAR_MUTAV_SOURCE_ACCOUNT`.
 * Generated once for the demo so muxed-address derivation works out of the
 * box. Real deployments must override.
 */
const DEV_FALLBACK_TREASURY = "GBADFR6K6RXDXUZ33Z5TRRPPRVEU2VEXORITHL4US4MSUSGSUPBSWS3S";

const DEFAULT_HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
const DEFAULT_HORIZON_PUBLIC = "https://horizon.stellar.org";

export function getMutavSourceAccount(): string {
  return process.env.STELLAR_MUTAV_SOURCE_ACCOUNT ?? DEV_FALLBACK_TREASURY;
}

export function getStellarNetwork(): "testnet" | "public" {
  return process.env.STELLAR_NETWORK === "public" ? "public" : "testnet";
}

export function getStellarHorizonUrl(): string {
  const explicit = process.env.STELLAR_HORIZON_URL;
  if (explicit) return explicit;
  return getStellarNetwork() === "public" ? DEFAULT_HORIZON_PUBLIC : DEFAULT_HORIZON_TESTNET;
}

/**
 * Lazy getter for the Stellar treasury secret (`S...`) — required only
 * inside anchor actions that sign SEP-10 challenges. Throws with a
 * helpful message if the env var is missing, so callers that never sign
 * (e.g., the Horizon indexer) don't trip on missing config.
 *
 * Production keys MUST be set via a secret manager / HSM — the env-var
 * route here is fine for dev and per-PR preview deployments only.
 */
export function getTreasurySecret(): string {
  const secret = process.env.MUTAV_TREASURY_SECRET;
  if (!secret) {
    throw new Error(
      "MUTAV_TREASURY_SECRET is not set. " +
        "Anchor on-ramp actions (SEP-10 auth) require the treasury Stellar secret. " +
        "Set it via `bunx convex env set MUTAV_TREASURY_SECRET S...` for dev/preview; " +
        "production must wire a secret manager.",
    );
  }
  if (!secret.startsWith("S") || secret.length !== 56) {
    throw new Error(
      "MUTAV_TREASURY_SECRET does not look like a Stellar secret seed (expected 'S' prefix, 56 chars).",
    );
  }
  return secret;
}

/**
 * Etherfuse REST API base URL. Defaults to the sandbox; production
 * deployments must set `ETHERFUSE_BASE_URL=https://api.etherfuse.com`.
 */
export function getEtherfuseBaseUrl(): string {
  return process.env.ETHERFUSE_BASE_URL ?? "https://api.sand.etherfuse.com";
}

/**
 * Lazy getter for the Etherfuse API key. Format: `api_sand:<uuid>:<uuid>`
 * (sandbox) or `api_prod:<uuid>:<uuid>`. Generated at devnet.etherfuse.com
 * (Ramp → API Keys). Required for any anchor action that touches Etherfuse
 * REST endpoints.
 */
export function getEtherfuseApiKey(): string {
  const key = process.env.ETHERFUSE_API_KEY;
  if (!key) {
    throw new Error(
      "ETHERFUSE_API_KEY is not set. " +
        "Etherfuse on-ramp actions require the key. " +
        "Get one at https://devnet.etherfuse.com → Ramp → API Keys, " +
        "then set with `bunx convex env set ETHERFUSE_API_KEY api_sand:...`.",
    );
  }
  return key;
}

/**
 * Base64 secret returned once at webhook creation
 * (POST /ramp/webhook → response.secret). Used by `convex/http.ts` to
 * verify HMAC-SHA256 over canonicalized JSON per
 * docs.etherfuse.com/guides/verifying-webhooks.
 *
 * Each Convex deployment registers its own webhook URL (the deployment's
 * .convex.site origin), so this secret is per-environment, not per-agency.
 * Register via `bun run scripts/etherfuse-register-webhook.ts <url>` and
 * paste the returned secret into the env.
 */
export function getEtherfuseWebhookSecret(): string {
  const secret = process.env.ETHERFUSE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "ETHERFUSE_WEBHOOK_SECRET is not set. " +
        "Register a webhook with `bun run scripts/etherfuse-register-webhook.ts <https-url>` " +
        "and set with `bunx convex env set ETHERFUSE_WEBHOOK_SECRET <base64>`.",
    );
  }
  return secret;
}

/**
 * 32-byte base64-encoded key for AES-256-GCM envelope encryption of
 * per-agency Stellar proxy account secrets. Required by
 * `convex/lib/secrets.ts` whenever PR-2's proxy provisioning runs.
 *
 * Generate one for dev/preview with:
 *
 *   openssl rand -base64 32
 *
 * Production should rotate to a managed secret (KMS/HSM/Vault) — this
 * env-derived path is the dev/preview default per `.claude/notes/deferred-conventions.md`.
 */
export function getStellarSecretEncryptionKey(): Buffer {
  const raw = process.env.MUTAV_STELLAR_SECRET_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MUTAV_STELLAR_SECRET_ENCRYPTION_KEY is not set. " +
        "Per-agency proxy account provisioning requires an encryption key. " +
        "Generate one via `openssl rand -base64 32` and set with " +
        "`bunx convex env set MUTAV_STELLAR_SECRET_ENCRYPTION_KEY <base64>`.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `MUTAV_STELLAR_SECRET_ENCRYPTION_KEY must decode to 32 bytes (AES-256); got ${key.length}.`,
    );
  }
  return key;
}

/**
 * 32-byte base64-encoded AES-256-GCM key for PII envelope encryption
 * (`convex/lib/pii.ts:encryptPii` / `decryptPii`). Separate from the
 * Stellar secret key and from the HMAC key below — compromise of one
 * MUST NOT compromise the others.
 *
 * Generate dev/preview keys with `openssl rand -base64 32` and set via
 * `bunx convex env set PII_ENCRYPTION_KEY <base64>`. Production rotates
 * to a managed secret per `.claude/notes/deferred-conventions.md`.
 */
export function getPiiEncryptionKey(): Buffer {
  const raw = process.env.PII_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "PII_ENCRYPTION_KEY is not set. " +
        "PII field encryption requires a 32-byte key. " +
        "Generate one via `openssl rand -base64 32` and set with " +
        "`bunx convex env set PII_ENCRYPTION_KEY <base64>`.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`PII_ENCRYPTION_KEY must decode to 32 bytes (AES-256); got ${key.length}.`);
  }
  return key;
}

/**
 * Optional Stellar secret seed (`S…`) for the dedicated audit-anchor
 * account. Returns null when unset — the daily anchor cron then computes
 * and persists the Merkle root locally (status: `pending`) but skips the
 * Stellar submission. This is the dev/preview default.
 *
 * In production, set this to a freshly-generated single-sig Stellar
 * account funded with ~10 XLM (enough for several years of daily
 * 100-stroop memo-hash transactions). The account is intentionally
 * separate from `MUTAV_TREASURY_SECRET` so audit-anchor failures can't
 * leak treasury authority, and so a treasury rotation doesn't force an
 * audit-anchor rotation. Compromise impact is bounded: an attacker could
 * submit a wrong root, and `verifyLatestAnchor` would surface the
 * mismatch — no loss of funds, just loss of anchor integrity until
 * rotation.
 *
 *   `bunx convex env set AUDIT_ANCHOR_SECRET S...`
 */
export function getAuditAnchorSecret(): string | null {
  const secret = process.env.AUDIT_ANCHOR_SECRET;
  if (!secret) return null;
  if (!secret.startsWith("S") || secret.length !== 56) {
    throw new Error(
      "AUDIT_ANCHOR_SECRET does not look like a Stellar secret seed (expected 'S' prefix, 56 chars).",
    );
  }
  return secret;
}

/**
 * 32-byte base64-encoded HMAC-SHA256 key for PII equality lookups
 * (`convex/lib/pii.ts:hashPii`). The pepper that makes CPF's ~10¹¹
 * keyspace non-enumerable.
 *
 * MUST be a separate secret from `PII_ENCRYPTION_KEY` — two keys means
 * compromise of one ≠ compromise of both. Rotation invalidates every
 * existing `*Hash` column, so a future rotation needs a re-hash
 * migration; treat as long-lived.
 *
 * Generate dev/preview keys with `openssl rand -base64 32` and set via
 * `bunx convex env set PII_HMAC_KEY <base64>`.
 */
export function getPiiHmacKey(): Buffer {
  const raw = process.env.PII_HMAC_KEY;
  if (!raw) {
    throw new Error(
      "PII_HMAC_KEY is not set. " +
        "PII hash lookups require a 32-byte HMAC key. " +
        "Generate one via `openssl rand -base64 32` and set with " +
        "`bunx convex env set PII_HMAC_KEY <base64>`.",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`PII_HMAC_KEY must decode to 32 bytes; got ${key.length}.`);
  }
  return key;
}
