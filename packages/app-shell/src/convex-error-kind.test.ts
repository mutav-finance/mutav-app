import { describe, expect, test } from "vitest";
import { classifyConvexError } from "./convex-error-kind";

describe("classifyConvexError", () => {
  test("a TypeError is transport (fetch never completed)", () => {
    expect(classifyConvexError(new TypeError("fetch failed"))).toBe("transport");
  });

  test.each([
    ['{"code":"InvalidAuthHeader","message":"Could not parse JWT payload"}'],
    ['{"code":"NoAuthProvider","message":"No auth provider found matching the given token"}'],
    ["Could not verify OIDC token claim. Check that the token signature is valid"],
    ["Token expired 30 seconds ago"],
    ["[Request ID: abc] Server Error\nUncaught UnauthenticatedError: Authentication required"],
    ["Uncaught Error: Authenticated, but no user row provisioned. Call ..."],
  ])("%s is auth_rejected", (message) => {
    expect(classifyConvexError(new Error(message))).toBe("auth_rejected");
  });

  test("an error named UnauthenticatedError is auth_rejected", () => {
    const error = new Error("whatever");
    error.name = "UnauthenticatedError";
    expect(classifyConvexError(error)).toBe("auth_rejected");
  });

  test.each([
    [new Error("[Request ID: abc] Server Error")],
    [new Error("Uncaught Error: index out of range")],
    ["a thrown string"],
    [null],
  ])("%s is server_error", (error) => {
    expect(classifyConvexError(error)).toBe("server_error");
  });

  test("returns only the enum, never the message", () => {
    const kind = classifyConvexError(new Error("InvalidAuthHeader secret-detail"));
    expect(kind).not.toContain("secret");
  });
});
