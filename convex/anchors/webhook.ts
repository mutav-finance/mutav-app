import { z } from "zod";

// ─── Zod schemas ──────────────────────────────────────────────────────────────
//
// Derived from the Etherfuse OpenAPI WebhookEvent schema
// (docs.etherfuse.com/openapi.yaml, see WebhookEvent definition). The payload
// is a tagged union with a single top-level key matching the event type:
//   { "order_updated": { ...orderFields } }
//   { "kyc_updated":   { ...kycFields   } }
// We only parse fields we actually consume; unknown keys pass through.

export const orderUpdatedSchema = z
  .object({
    orderId: z.string(),
    customerId: z.string(),
    status: z.string(),
    confirmedTxSignature: z.string().optional(),
  })
  .passthrough();

export const kycUpdatedSchema = z
  .object({
    customerId: z.string(),
    status: z.string(),
  })
  .passthrough();

export const etherfuseWebhookPayloadSchema = z.object({
  order_updated: orderUpdatedSchema.optional(),
  kyc_updated: kycUpdatedSchema.optional(),
  customer_updated: z.unknown().optional(),
  bank_account_updated: z.unknown().optional(),
  swap_updated: z.unknown().optional(),
  quote_updated: z.unknown().optional(),
});

export type EtherfuseWebhookPayload = z.infer<typeof etherfuseWebhookPayloadSchema>;

// ─── HMAC verification ────────────────────────────────────────────────────────
//
// Etherfuse signs the raw request body with HMAC-SHA256 using the per-webhook
// secret and ships the result in the `X-Signature` header as `sha256=<hex>`.
// We use Web Crypto (`globalThis.crypto.subtle`) because Convex `httpAction`s
// run in the V8 runtime, not Node — `node:crypto` is not available here.

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// Constant-time comparison over raw byte arrays. Returns false on length
// mismatch — never short-circuits within the loop.
function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    diff |= av ^ bv;
  }
  return diff === 0;
}

export async function verifyEtherfuseSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const match = /^sha256=([0-9a-f]+)$/i.exec(signatureHeader.trim());
  if (!match) return false;
  const providedHex = match[1];
  if (!providedHex || providedHex.length % 2 !== 0) return false;

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const computed = new Uint8Array(signatureBuffer);
  const computedHex = bytesToHex(computed);

  if (providedHex.length !== computedHex.length) return false;
  return timingSafeEqualBytes(hexToBytes(providedHex), computed);
}

// ─── Event ID derivation ──────────────────────────────────────────────────────
//
// Etherfuse does not surface an explicit event_id in the OpenAPI WebhookEvent
// schema. Each event-data object does carry stable identifiers (orderId,
// customerId) and a `status` that transitions over time. We derive a
// composite key for dedupe — replay of the exact same `(event_type, entity,
// status)` triple should be idempotent. If the spec gains an explicit id
// field later, switch to that.

export function deriveEventId(
  payload: EtherfuseWebhookPayload,
): { eventType: string; eventId: string } | null {
  if (payload.order_updated) {
    const o = payload.order_updated;
    return {
      eventType: "order_updated",
      eventId: `order_updated:${o.orderId}:${o.status}`,
    };
  }
  if (payload.kyc_updated) {
    const k = payload.kyc_updated;
    return {
      eventType: "kyc_updated",
      eventId: `kyc_updated:${k.customerId}:${k.status}`,
    };
  }
  return null;
}
