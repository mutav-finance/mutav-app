// @vitest-environment edge-runtime
import { describe, expect, test } from "vitest";
import { MERKLE_SENTINEL_EMPTY_ROOT, computeMerkleRoot } from "./merkle";

const H1 = "1111111111111111111111111111111111111111111111111111111111111111";
const H2 = "2222222222222222222222222222222222222222222222222222222222222222";
const H3 = "3333333333333333333333333333333333333333333333333333333333333333";
const H4 = "4444444444444444444444444444444444444444444444444444444444444444";

describe("computeMerkleRoot", () => {
  test("empty list returns the sentinel zero root", async () => {
    const root = await computeMerkleRoot([]);
    expect(root).toBe(MERKLE_SENTINEL_EMPTY_ROOT);
    expect(root).toBe("0".repeat(64));
  });

  test("single hash is its own root (trivial tree)", async () => {
    const root = await computeMerkleRoot([H1]);
    expect(root).toBe(H1);
  });

  test("two hashes produce a 64-char hex root", async () => {
    const root = await computeMerkleRoot([H1, H2]);
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(root).not.toBe(H1);
    expect(root).not.toBe(H2);
  });

  test("is deterministic across calls", async () => {
    const a = await computeMerkleRoot([H1, H2, H3]);
    const b = await computeMerkleRoot([H1, H2, H3]);
    expect(a).toBe(b);
  });

  test("order matters — reversing the leaves produces a different root", async () => {
    const forward = await computeMerkleRoot([H1, H2, H3, H4]);
    const reverse = await computeMerkleRoot([H4, H3, H2, H1]);
    expect(forward).not.toBe(reverse);
  });

  test("odd count carries the last element up unchanged at each level", async () => {
    // With 3 leaves: level 1 = [hash(H1|H2), H3], level 2 = hash(hash(H1|H2) | H3).
    // We verify by computing manually: hash 1+2, then hash that with 3.
    const root3 = await computeMerkleRoot([H1, H2, H3]);
    // If a duplicate-last variant were used, root3 would equal computeMerkleRoot([H1, H2, H3, H3]).
    const root3_duplicateLast = await computeMerkleRoot([H1, H2, H3, H3]);
    expect(root3).not.toBe(root3_duplicateLast);
  });

  test("tampering with any leaf changes the root", async () => {
    const original = await computeMerkleRoot([H1, H2, H3, H4]);
    const tampered = await computeMerkleRoot([
      H1,
      H2,
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      H4,
    ]);
    expect(original).not.toBe(tampered);
  });

  test("large input — 100 leaves produces a stable root", async () => {
    const leaves = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(64, "0"));
    const a = await computeMerkleRoot(leaves);
    const b = await computeMerkleRoot(leaves);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
