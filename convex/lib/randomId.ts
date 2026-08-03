/**
 * Unguessable identifier generation.
 *
 * Uses `crypto.getRandomValues`, never `Math.random()`. V8 implements
 * `Math.random` as xorshift128+, whose 128-bit internal state is recoverable
 * from a handful of observed outputs — so a caller who sees a few ids it
 * generated itself can predict every subsequent id, including other tenants'.
 * Every identifier produced here gates access to personal data, which is what
 * makes the distinction load-bearing rather than stylistic.
 */

// Crockford base32: no I, L, O or U, so there is no character pair a human can
// confuse reading an id off a printed invoice or dictating it over the phone.
const UNAMBIGUOUS_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// A 32-character alphabet divides 256 exactly, so `byte % length` is uniform.
// Any other alphabet size would need rejection sampling to avoid modulo bias.
function randomChars(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const byte of bytes) out += UNAMBIGUOUS_ALPHABET[byte % UNAMBIGUOUS_ALPHABET.length];
  return out;
}

const CONTRACT_ID_CHARS = 8;
const INVOICE_ACCESS_TOKEN_CHARS = 32;
const AGENCY_INVOICE_REF_CHARS = 4;

/**
 * Agency-facing contract reference (`CTR-XXXXXXXX`). Reads that resolve it are
 * membership-gated, so this is a readability aid rather than a secret; 40 bits
 * of entropy keeps it unguessable anyway so a leaked id in a URL or a support
 * ticket discloses nothing on its own.
 */
export function generateContractPublicId(): string {
  return `CTR-${randomChars(CONTRACT_ID_CHARS)}`;
}

/**
 * Bearer token for the unauthenticated tenant checkout (`apps/pay`). Holding it
 * IS the authorization — there is no session behind it — so it carries 160 bits
 * and must never be derived from anything observable.
 *
 * It is deliberately NOT the invoice's `publicId`: that stays a human-readable
 * document number (`INV-{agencyRef}-{NNNN}`, see `generateAgencyInvoiceRef`)
 * which is a reference, not a secret. Keeping the reference and the credential
 * as two separate fields is what stops the document number from becoming a
 * password.
 */
export function generateInvoiceAccessToken(): string {
  return randomChars(INVOICE_ACCESS_TOKEN_CHARS);
}

/**
 * Per-agency prefix for invoice document numbers (`INV-{ref}-{NNNN}`). Minted
 * once per agency and never changed, so an agency's invoices sort and group
 * together and a human can read the number back over the phone.
 *
 * It is random rather than derived. The previous scheme used the last four
 * digits of the agency's CNPJ or CPF, which was wrong twice over: a partial
 * tax ID is still personal data when the agency is an empresário individual or
 * MEI (those hold a CNPJ with no legal personality separate from the natural
 * person behind it), and four digits collide — two agencies sharing a tail
 * produced the same document number, which `.unique()` readers throw on.
 *
 * 4 chars of Crockford base32 is ~20 bits. That is not a secret and is not
 * meant to be: uniqueness comes from the per-agency sequence appended to it,
 * and `assertUniquePublicId` is what actually enforces it at write time.
 */
export function generateAgencyInvoiceRef(): string {
  return randomChars(AGENCY_INVOICE_REF_CHARS);
}
