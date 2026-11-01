/**
 * The path the proxy saw for this request, forwarded to the render so a
 * layout-level login redirect can send the user back to the page they asked
 * for. The proxy overwrites any client-sent value.
 */
export const RETURN_TO_HEADER = "x-mutav-return-to";

/**
 * `value` when it is a path on this origin, else `null`. `//host` and
 * `/\host` are protocol-relative to a browser, so they are refused.
 */
export function sameOriginPath(value: string | null): string | null {
  if (!value?.startsWith("/")) return null;
  if (value[1] === "/" || value[1] === "\\") return null;
  return value;
}
