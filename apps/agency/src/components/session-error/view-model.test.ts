import { describe, expect, it } from "vitest";
import { parseSessionErrorReason, resolveSessionErrorView } from "./view-model";

describe("parseSessionErrorReason", () => {
  it.each(["not-provisioned", "backend-unavailable", "email-not-verified", "email-bound"])(
    "accepts the known reason %s",
    (reason) => {
      expect(parseSessionErrorReason(reason)).toBe(reason);
    },
  );

  it.each([
    undefined,
    "",
    "session-expired",
    "<script>",
    "EMAIL_NOT_VERIFIED",
    ["not-provisioned", "x"],
    ["email-bound"],
  ])("falls back to backend-unavailable for %j", (raw) => {
    expect(parseSessionErrorReason(raw)).toBe("backend-unavailable");
  });
});

describe("resolveSessionErrorView", () => {
  it("uses the account-setup copy for not-provisioned", () => {
    expect(resolveSessionErrorView("not-provisioned")).toEqual({
      tone: "notProvisioned",
      eyebrowKey: "notProvisioned.eyebrow",
      titleKey: "notProvisioned.title",
      subtitleKey: "notProvisioned.subtitle",
      primaryAction: { kind: "retry", href: "/", labelKey: "tryAgain" },
    });
  });

  it("uses the outage copy for backend-unavailable", () => {
    expect(resolveSessionErrorView("backend-unavailable")).toEqual({
      tone: "backendUnavailable",
      eyebrowKey: "backendUnavailable.eyebrow",
      titleKey: "backendUnavailable.title",
      subtitleKey: "backendUnavailable.subtitle",
      primaryAction: { kind: "retry", href: "/", labelKey: "tryAgain" },
    });
  });

  it("tells the user to verify the email and sign in again for email-not-verified", () => {
    expect(resolveSessionErrorView("email-not-verified")).toEqual({
      tone: "emailNotVerified",
      eyebrowKey: "emailNotVerified.eyebrow",
      titleKey: "emailNotVerified.title",
      subtitleKey: "emailNotVerified.subtitle",
      primaryAction: {
        kind: "relogin",
        href: "/auth/login?returnTo=/",
        labelKey: "confirmedSignInAgain",
      },
    });
  });

  it("points the user to support for email-bound", () => {
    expect(resolveSessionErrorView("email-bound")).toEqual({
      tone: "emailBound",
      eyebrowKey: "emailBound.eyebrow",
      titleKey: "emailBound.title",
      subtitleKey: "emailBound.subtitle",
      primaryAction: { kind: "retry", href: "/", labelKey: "tryAgain" },
    });
  });
});
