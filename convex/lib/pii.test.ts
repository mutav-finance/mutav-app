// @vitest-environment edge-runtime
import { beforeAll, describe, expect, test } from "vitest";
import { decryptPii, encryptPii, hashPii } from "./pii";

// Distinct 32-byte keys per primitive — the security model relies on
// PII_ENCRYPTION_KEY ≠ PII_HMAC_KEY (compromise of one ≠ both).
const TEST_AES_KEY_B64 = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
const TEST_HMAC_KEY_B64 = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = TEST_AES_KEY_B64;
  process.env.PII_HMAC_KEY = TEST_HMAC_KEY_B64;
});

describe("encryptPii / decryptPii", () => {
  test("roundtrips plaintext", async () => {
    const envelope = await encryptPii("11144477735");
    const decrypted = await decryptPii(envelope);
    expect(decrypted).toBe("11144477735");
  });

  test("each encryption produces a fresh IV and ciphertext", async () => {
    const a = await encryptPii("11144477735");
    const b = await encryptPii("11144477735");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  test("envelope shape: ciphertext / iv / authTag are base64 strings", async () => {
    const envelope = await encryptPii("11144477735");
    for (const field of ["ciphertext", "iv", "authTag"] as const) {
      expect(typeof envelope[field]).toBe("string");
      expect(envelope[field]).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
    // 12-byte IV → 16 chars base64
    expect(envelope.iv.length).toBe(16);
    // 16-byte auth tag → 24 chars base64 with padding
    expect(envelope.authTag.length).toBe(24);
  });

  test("auth tag tamper is detected on decrypt", async () => {
    const envelope = await encryptPii("11144477735");
    const tag = Buffer.from(envelope.authTag, "base64");
    tag[0] ^= 0x01;
    const tampered = { ...envelope, authTag: tag.toString("base64") };
    await expect(decryptPii(tampered)).rejects.toThrow();
  });

  test("ciphertext tamper is detected on decrypt", async () => {
    const envelope = await encryptPii("11144477735");
    const ct = Buffer.from(envelope.ciphertext, "base64");
    ct[0] ^= 0x01;
    const tampered = { ...envelope, ciphertext: ct.toString("base64") };
    await expect(decryptPii(tampered)).rejects.toThrow();
  });
});

describe("hashPii", () => {
  test("is deterministic", async () => {
    const a = await hashPii("11144477735");
    const b = await hashPii("11144477735");
    expect(a).toBe(b);
  });

  test("returns a 64-char lowercase hex string (SHA-256)", async () => {
    const hash = await hashPii("11144477735");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different inputs produce different hashes", async () => {
    const a = await hashPii("11144477735");
    const b = await hashPii("52998224725");
    expect(a).not.toBe(b);
  });

  test("different HMAC keys produce different hashes for the same input", async () => {
    const original = process.env.PII_HMAC_KEY;
    process.env.PII_HMAC_KEY = TEST_HMAC_KEY_B64;
    const a = await hashPii("11144477735");
    process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xcc)).toString("base64");
    const b = await hashPii("11144477735");
    process.env.PII_HMAC_KEY = original;
    expect(a).not.toBe(b);
  });
});
