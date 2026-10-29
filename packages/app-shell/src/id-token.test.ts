import { describe, expect, test } from "vitest";
import { idTokenExpiresAt } from "./id-token";
import { encodeJwtSegment as encodeSegment, jwtWithPayload } from "./jwt-fixture";

describe("idTokenExpiresAt", () => {
  test("returns exp in epoch seconds", () => {
    expect(idTokenExpiresAt(jwtWithPayload({ sub: "auth0|1", exp: 1_900_000_000 }))).toBe(
      1_900_000_000,
    );
  });

  test("decodes base64url payloads that use - and _", () => {
    const payload = { exp: 1_900_000_000, name: "??>>~~" };
    const token = jwtWithPayload(payload);
    expect(token.split(".")[1]).toMatch(/[-_]/);
    expect(idTokenExpiresAt(token)).toBe(1_900_000_000);
  });

  test.each([
    ["empty string", ""],
    ["no dots", "not-a-jwt"],
    ["two segments", "a.b"],
    ["four segments", "a.b.c.d"],
    ["payload not base64 json", "a.%%%.c"],
    ["payload is json but not an object", jwtWithPayload(42)],
    ["payload is null", jwtWithPayload(null)],
    ["exp missing", jwtWithPayload({ sub: "auth0|1" })],
    ["exp is a string", jwtWithPayload({ exp: "1900000000" })],
    [
      "exp is not finite",
      `${encodeSegment({})}.${Buffer.from('{"exp":1e999}').toString("base64url")}.s`,
    ],
  ])("returns null for %s", (_label, token) => {
    expect(idTokenExpiresAt(token)).toBeNull();
  });
});
