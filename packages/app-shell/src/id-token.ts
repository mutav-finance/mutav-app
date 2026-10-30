const JWT_SEGMENT_COUNT = 3;

/**
 * Reads `exp` (epoch seconds) from a JWT without verifying its signature. Only
 * for scheduling a refresh: Convex verifies the token itself.
 */
export function idTokenExpiresAt(token: string): number | null {
  const segments = token.split(".");
  if (segments.length !== JWT_SEGMENT_COUNT) return null;
  const payload = decodePayload(segments[1]);
  if (typeof payload !== "object" || payload === null || !("exp" in payload)) return null;
  const { exp } = payload;
  return typeof exp === "number" && Number.isFinite(exp) ? exp : null;
}

function decodePayload(segment: string | undefined): unknown {
  if (!segment) return null;
  try {
    const json: unknown = JSON.parse(base64UrlToUtf8(segment));
    return json;
  } catch {
    return null;
  }
}

// atob + TextDecoder rather than Buffer so this also runs on the edge runtime.
function base64UrlToUtf8(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
