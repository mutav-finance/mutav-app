import { v } from "convex/values";
import { getPiiEncryptionKey, getPiiHmacKey } from "./env";

const AES_ALGORITHM = "AES-GCM";
const HMAC_ALGORITHM = "HMAC";
const HASH_ALGORITHM = "SHA-256";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedEnvelope = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export const encryptedEnvelopeValidator = v.object({
  ciphertext: v.string(),
  iv: v.string(),
  authTag: v.string(),
});

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

// WebCrypto's `BufferSource` is narrowed to `ArrayBuffer`-backed views in
// recent TS lib defs; Node Buffers and Uint8Arrays from `getRandomValues`
// can be `ArrayBufferLike`-backed (which lets in `SharedArrayBuffer`) and
// fail the type check even though they work at runtime. Copying into a
// fresh ArrayBuffer satisfies the type and keeps the crypto inputs free
// of any shared-memory aliasing.
function toArrayBuffer(input: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(input.byteLength);
  new Uint8Array(out).set(input);
  return out;
}

function utf8(plaintext: string): ArrayBuffer {
  return toArrayBuffer(textEncoder.encode(plaintext));
}

async function importEncryptionKey(): Promise<CryptoKey> {
  const raw = toArrayBuffer(getPiiEncryptionKey());
  return crypto.subtle.importKey("raw", raw, { name: AES_ALGORITHM }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function importHmacKey(): Promise<CryptoKey> {
  const raw = toArrayBuffer(getPiiHmacKey());
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: HMAC_ALGORITHM, hash: HASH_ALGORITHM },
    false,
    ["sign"],
  );
}

/**
 * Encrypt a short PII string (CPF, email, name, …) into a storable
 * envelope. V8-compatible — runs inside queries and mutations.
 *
 * AES-256-GCM gives confidentiality + integrity. A fresh 12-byte IV per
 * call keeps the GCM uniqueness invariant; collision probability is ~0
 * at our throughput.
 *
 * WebCrypto returns ciphertext || authTag concatenated. We split the
 * trailing 16 bytes back out so the envelope shape matches the Node
 * primitive in `secrets.ts` (a single `{ciphertext, iv, authTag}`
 * contract across the codebase).
 */
export async function encryptPii(plaintext: string): Promise<EncryptedEnvelope> {
  const key = await importEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const combined = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: AES_ALGORITHM, iv: toArrayBuffer(iv) },
      key,
      utf8(plaintext),
    ),
  );
  const splitAt = combined.length - AUTH_TAG_BYTES;
  if (splitAt < 0) {
    throw new Error(
      `GCM output shorter than auth tag length (got ${combined.length}, expected ≥ ${AUTH_TAG_BYTES})`,
    );
  }
  return {
    ciphertext: bytesToBase64(combined.subarray(0, splitAt)),
    iv: bytesToBase64(iv),
    authTag: bytesToBase64(combined.subarray(splitAt)),
  };
}

/**
 * Decrypt an envelope back to plaintext. Throws if the auth tag fails
 * verification — that's how tampered ciphertext is detected.
 */
export async function decryptPii(envelope: EncryptedEnvelope): Promise<string> {
  const key = await importEncryptionKey();
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const authTag = base64ToBytes(envelope.authTag);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);
  const plaintext = await crypto.subtle.decrypt(
    { name: AES_ALGORITHM, iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(combined),
  );
  return textDecoder.decode(plaintext);
}

/**
 * Deterministic HMAC-SHA256 of a PII string, hex-encoded. Used as the
 * equality-lookup sidecar for encrypted fields (`fieldHash` in the
 * encrypted+hashed schema pattern).
 *
 * The HMAC key is a server-side pepper — without it, CPF's 11-digit
 * keyspace (~10¹¹) would be rainbow-table enumerable from a plain SHA.
 * Two-key separation (HMAC ≠ AES) is intentional; see ADR 0001.
 */
export async function hashPii(plaintext: string): Promise<string> {
  const key = await importHmacKey();
  const signature = await crypto.subtle.sign(HMAC_ALGORITHM, key, utf8(plaintext));
  return bytesToHex(new Uint8Array(signature));
}
