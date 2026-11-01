import type { SessionData } from "@auth0/nextjs-auth0/types";
import { SdkError } from "@auth0/nextjs-auth0/errors";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import { createOnCallback, type ProvisionMutation } from "./auth-callback";

const BASE = "https://app.example.test";
const CONVEX_URL = "https://convex.example.test";
const SECRET_MESSAGE = "secret-message-with-state-abc123";
const SECRET_CAUSE = "secret-cause-detail";
const ID_TOKEN = "id-token-fixture";

const provisionMutation: ProvisionMutation = makeFunctionReference<
  "mutation",
  Record<string, never>
>("users/useCases:getOrCreateByIdentity");

class CallbackError extends SdkError {
  public code: string;
  constructor(code: string) {
    super(SECRET_MESSAGE);
    this.name = "AuthorizationCodeGrantError";
    this.code = code;
    this.cause = new Error(SECRET_CAUSE);
  }
}

class CodelessError extends SdkError {
  public code = "";
  constructor() {
    super(SECRET_MESSAGE);
    this.name = "InvalidStateError";
  }
}

function session(idToken: string | undefined): SessionData {
  return {
    user: { sub: "auth0|fixture" },
    tokenSet: { accessToken: "access-token-fixture", expiresAt: 0, idToken },
    internal: { sid: "sid-fixture", createdAt: 0 },
  };
}

function fakeConvex({
  mutationError,
  mutationResult = null,
}: { mutationError?: Error; mutationResult?: unknown } = {}) {
  const client = {
    setAuth: vi.fn(),
    mutation: vi.fn(async () => {
      if (mutationError) throw mutationError;
      return mutationResult;
    }),
  };
  const createConvexClient = vi.fn(() => client);
  return { client, createConvexClient };
}

function hook({
  convexUrl = CONVEX_URL,
  convex = fakeConvex(),
}: { convexUrl?: string | null; convex?: ReturnType<typeof fakeConvex> } = {}) {
  return createOnCallback({
    getAppBaseUrl: () => BASE,
    getConvexUrl: () => convexUrl,
    provisionMutation,
    createConvexClient: convex.createConvexClient,
  });
}

let consoleError: MockInstance<typeof console.error>;
let consoleWarn: MockInstance<typeof console.warn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

function loggedText(): string {
  return JSON.stringify(consoleError.mock.calls, (_key, value: unknown) =>
    value instanceof Error ? { name: value.name, message: value.message } : value,
  );
}

describe("createOnCallback", () => {
  describe("error", () => {
    test("redirects to logout with the code, never the message", async () => {
      const res = await hook()(new CallbackError("callback_error"), { returnTo: "/x" }, null);
      const location = res.headers.get("location");
      expect(location).toBe(`${BASE}/auth/logout?error=callback_error`);
      expect(location).not.toContain("secret");
    });

    test("falls back to callback_failed when the code is empty", async () => {
      const res = await hook()(new CodelessError(), {}, null);
      expect(res.headers.get("location")).toBe(`${BASE}/auth/logout?error=callback_failed`);
    });

    test("encodes the code", async () => {
      const res = await hook()(new CallbackError("a&b=c"), {}, null);
      expect(res.headers.get("location")).toBe(`${BASE}/auth/logout?error=a%26b%3Dc`);
    });

    test("logs only name and code", async () => {
      await hook()(new CallbackError("callback_error"), {}, null);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), {
        name: "AuthorizationCodeGrantError",
        code: "callback_error",
      });
      expect(loggedText()).not.toContain("secret");
    });

    test("does not provision", async () => {
      const convex = fakeConvex();
      await hook({ convex })(new CallbackError("callback_error"), {}, session(ID_TOKEN));
      expect(convex.createConvexClient).not.toHaveBeenCalled();
    });
  });

  describe("provisioning", () => {
    test("runs the mutation authenticated as the new id token", async () => {
      const convex = fakeConvex();
      await hook({ convex })(null, {}, session(ID_TOKEN));
      expect(convex.createConvexClient).toHaveBeenCalledWith(CONVEX_URL);
      expect(convex.client.setAuth).toHaveBeenCalledWith(ID_TOKEN);
      expect(convex.client.mutation).toHaveBeenCalledWith(provisionMutation, {});
    });

    test("fails open: a mutation throw still redirects and logs only the name", async () => {
      const failure = new Error(SECRET_MESSAGE);
      failure.name = "ConvexError";
      const convex = fakeConvex({ mutationError: failure });
      const res = await hook({ convex })(null, { returnTo: "/en/claims" }, session(ID_TOKEN));
      expect(res.headers.get("location")).toBe(`${BASE}/en/claims`);
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), { name: "ConvexError" });
      expect(loggedText()).not.toContain("secret");
    });

    test("fails open on a refusal and logs only its code", async () => {
      const convex = fakeConvex({
        mutationResult: {
          success: false,
          error: { code: "EMAIL_NOT_VERIFIED" },
          message: SECRET_MESSAGE,
        },
      });
      const res = await hook({ convex })(null, { returnTo: "/en/claims" }, session(ID_TOKEN));
      expect(res.headers.get("location")).toBe(`${BASE}/en/claims`);
      expect(consoleWarn).toHaveBeenCalledWith(expect.any(String), { code: "EMAIL_NOT_VERIFIED" });
      expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("secret");
    });

    test("logs nothing on a successful provisioning", async () => {
      const convex = fakeConvex({
        mutationResult: { success: true, data: { created: false }, message: "ok" },
      });
      await hook({ convex })(null, {}, session(ID_TOKEN));
      expect(consoleWarn).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    });

    test("a mutation throw also logs the cause's code when it has one", async () => {
      const cause = Object.assign(new Error(SECRET_CAUSE), { code: "ECONNRESET" });
      const failure = new TypeError(SECRET_MESSAGE, { cause });
      const convex = fakeConvex({ mutationError: failure });
      await hook({ convex })(null, {}, session(ID_TOKEN));
      expect(consoleError).toHaveBeenCalledWith(expect.any(String), {
        name: "TypeError",
        causeCode: "ECONNRESET",
      });
      expect(loggedText()).not.toContain("secret");
    });

    test("logs when provisioning is skipped for a missing Convex URL", async () => {
      await hook({ convexUrl: null })(null, {}, session(ID_TOKEN));
      expect(consoleWarn).toHaveBeenCalledWith(
        "[auth0.onCallback] provisioning skipped: no Convex URL",
      );
    });

    test.each([
      ["no convex url", { convexUrl: null, idToken: ID_TOKEN }],
      ["no id token", { convexUrl: CONVEX_URL, idToken: undefined }],
    ])("is skipped with %s", async (_label, { convexUrl, idToken }) => {
      const convex = fakeConvex();
      const res = await hook({ convexUrl, convex })(null, {}, session(idToken));
      expect(convex.createConvexClient).not.toHaveBeenCalled();
      expect(res.headers.get("location")).toBe(`${BASE}/`);
    });

    test("is skipped without a session", async () => {
      const convex = fakeConvex();
      await hook({ convex })(null, {}, null);
      expect(convex.createConvexClient).not.toHaveBeenCalled();
    });
  });

  describe("success redirect", () => {
    test("keeps a same-origin returnTo", async () => {
      const res = await hook()(null, { returnTo: "/en/claims?case=1" }, session(ID_TOKEN));
      expect(res.headers.get("location")).toBe(`${BASE}/en/claims?case=1`);
    });

    test.each(["//evil.example/x", "/\\evil.example/x", "https://evil.example/x"])(
      "a hostile returnTo %s stays on origin",
      async (returnTo) => {
        const res = await hook()(null, { returnTo }, session(ID_TOKEN));
        expect(res.headers.get("location")).toBe(`${BASE}/`);
      },
    );
  });
});
