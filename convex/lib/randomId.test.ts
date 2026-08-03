import { describe, expect, test } from "vitest";

import { generateContractPublicId, generateInvoiceAccessToken } from "./randomId";

const SAMPLE_SIZE = 2000;

describe("generateContractPublicId", () => {
  test("carries the CTR- prefix and eight body characters", () => {
    const id = generateContractPublicId();
    expect(id).toMatch(/^CTR-[0-9A-HJKMNP-TV-Z]{8}$/);
  });

  test("never emits the ambiguous characters I, L, O or U", () => {
    const body = Array.from({ length: SAMPLE_SIZE }, () =>
      generateContractPublicId().slice(4),
    ).join("");
    expect(body).not.toMatch(/[ILOU]/);
  });

  test("does not collide across a large sample", () => {
    const ids = new Set(Array.from({ length: SAMPLE_SIZE }, generateContractPublicId));
    expect(ids.size).toBe(SAMPLE_SIZE);
  });
});

describe("generateInvoiceAccessToken", () => {
  test("is 32 characters of the unambiguous alphabet", () => {
    expect(generateInvoiceAccessToken()).toMatch(/^[0-9A-HJKMNP-TV-Z]{32}$/);
  });

  test("does not collide across a large sample", () => {
    const tokens = new Set(Array.from({ length: SAMPLE_SIZE }, generateInvoiceAccessToken));
    expect(tokens.size).toBe(SAMPLE_SIZE);
  });

  test("distributes over the whole alphabet rather than a biased subset", () => {
    // A 32-char alphabet divides 256 exactly, so every character should appear
    // with roughly equal frequency. A modulo-biased implementation would skew
    // the low end of the alphabet; a constant-ish one would collapse the set.
    const chars = Array.from({ length: SAMPLE_SIZE }, generateInvoiceAccessToken).join("");
    const distinct = new Set(chars);
    expect(distinct.size).toBe(32);

    const expected = chars.length / 32;
    for (const char of distinct) {
      const count = chars.split(char).length - 1;
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });
});
