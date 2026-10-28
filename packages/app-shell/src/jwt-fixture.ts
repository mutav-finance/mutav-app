export function encodeJwtSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function jwtWithPayload(payload: unknown): string {
  return `${encodeJwtSegment({ alg: "RS256", typ: "JWT" })}.${encodeJwtSegment(payload)}.signature`;
}

export function idTokenExpiringAt(exp: number): string {
  return jwtWithPayload({ sub: "auth0|fixture", exp });
}
