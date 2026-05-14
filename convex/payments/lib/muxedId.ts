const MAX_BIT = BigInt(1) << BigInt(63);
const MASK_63_BIT = MAX_BIT - BigInt(1);

/**
 * 63-bit unsigned integer as a digit string. Stays below 2^63 to avoid the
 * signed/unsigned ambiguity some wallets exhibit and to keep the value
 * safely representable as a string across the IEEE-754 boundary.
 *
 * Isolated from stellar-base so callers that only mint ids (seed, mutations)
 * don't pull the SDK into their module graph.
 */
export function generatePaymentMuxedId(): string {
  const buffer = new BigUint64Array(1);
  crypto.getRandomValues(buffer);
  const raw = buffer[0] as bigint;
  return (raw & MASK_63_BIT).toString();
}
