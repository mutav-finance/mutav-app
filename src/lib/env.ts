/**
 * Client-side env getters. Only NEXT_PUBLIC_* vars exist in the browser
 * bundle — anything else returns undefined. This is the only file under
 * src/ that's allowed to read `process.env` directly; see CLAUDE.md.
 */

/**
 * Whether to render the testanchor (SEP-24 hosted-UI debugging) card on
 * the public payment picker at `/pagar/[publicId]`. Off by default once
 * the Etherfuse Pix on-ramp is live; on for dev/preview when we want to
 * verify SEP-side behavior without touching production payment flow.
 *
 * Toggle: `NEXT_PUBLIC_SHOW_TESTANCHOR=true` (any value coerces to true;
 * undefined or empty string keep it hidden).
 */
export function shouldShowTestanchor(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SHOW_TESTANCHOR);
}
