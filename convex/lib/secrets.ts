"use node";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getStellarSecretEncryptionKey } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export type EncryptedEnvelope = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

/**
 * Encrypt a Stellar secret seed (or any short string) under the project
 * key. AES-256-GCM gives confidentiality + integrity in one primitive;
 * the auth tag detects any ciphertext tampering on decrypt.
 *
 * Don't reuse the IV across calls — `randomBytes(12)` is the cryptographic
 * minimum for GCM and collision probability is ~zero at our throughput.
 */
export function encryptSecret(plaintext: string): EncryptedEnvelope {
  const key = getStellarSecretEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `GCM auth tag length mismatch (expected ${AUTH_TAG_BYTES}, got ${authTag.length})`,
    );
  }
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(envelope: EncryptedEnvelope): string {
  const key = getStellarSecretEncryptionKey();
  const iv = Buffer.from(envelope.iv, "base64");
  const authTag = Buffer.from(envelope.authTag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
