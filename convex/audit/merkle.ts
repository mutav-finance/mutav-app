/**
 * Pure Merkle root computation over hex SHA-256 strings.
 *
 * Used by the daily audit anchor cron to collapse a batch of audit-log
 * `entryHash` values into a single `rootHash` that can be committed to
 * Stellar via a MEMO_HASH transaction. The submitted memo is the external,
 * uneditable witness that proves "these N audit entries existed at this
 * point in time" — even if the entire Convex deployment is later rewritten.
 *
 * Variant: odd elements carry up unchanged (Bitcoin / Certificate Transparency
 * use the "duplicate last" variant; both are tamper-evident, but carry-up
 * lets us trivially verify a single-leaf tree without a synthetic duplicate).
 * Documented here so verifyLatestAnchor mirrors the construction exactly.
 */

const SENTINEL_EMPTY_ROOT = "0".repeat(64);

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  let hex = "";
  for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Hash two children. The pair is canonicalized as `${left}|${right}` so
 * verification recomputes byte-for-byte; the separator ensures no input
 * pair can be confused with another by clever string concatenation.
 */
async function hashPair(left: string, right: string): Promise<string> {
  return sha256Hex(`${left}|${right}`);
}

/**
 * Compute the Merkle root over an ordered list of hex hashes.
 *
 * - Empty list → SENTINEL_EMPTY_ROOT (64 zero chars). An anchor over zero
 *   entries is meaningful — it asserts "no audit entries existed in the
 *   period", which is itself a verifiable claim.
 * - Single hash → that hash unchanged (trivial tree).
 * - Multiple hashes → recursive pairing; odd-count levels carry the last
 *   element up to the next level untouched.
 */
export async function computeMerkleRoot(hashes: readonly string[]): Promise<string> {
  if (hashes.length === 0) return SENTINEL_EMPTY_ROOT;
  if (hashes.length === 1) return hashes[0];

  let level: readonly string[] = hashes;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(await hashPair(level[i], level[i + 1]));
      } else {
        // Odd element — carry up unchanged.
        next.push(level[i]);
      }
    }
    level = next;
  }
  return level[0];
}

export const MERKLE_SENTINEL_EMPTY_ROOT = SENTINEL_EMPTY_ROOT;
