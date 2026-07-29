/**
 * Parse a pt-BR currency string (as produced by `<CurrencyInput>`) into an
 * integer number of cents.
 *
 * Convention:
 * - Dot is the thousands separator, comma is the decimal separator
 *   (e.g. "R$ 1.234,56" → 123456).
 * - Optional "R$ " prefix and surrounding whitespace are stripped.
 *
 * Returns `null` for empty input, unparseable input, or non-positive values.
 * Callers use the null return to surface a submit-time "missing / invalid
 * amount" error to the user.
 *
 * Distinct from `parseBRLInput` in `../contracts/wizard.ts`, which returns
 * `0` on invalid/empty input. That zero-returning variant is used by the
 * contract wizard's `onBlur` handlers to write into draft state, where a
 * cleared field must produce a stable numeric zero. This null-returning
 * variant is for submit-time validation, where an empty field must be
 * distinguishable from an intentional zero.
 */
export function parseAmountToCents(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  const cleaned = trimmed
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.round(parsed * 100);
  }
  return null;
}
