import { describe, expect, it } from "vitest";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import type { StaffGateResult } from "@/lib/auth";
import { resolveAccessDeniedView } from "./view-model";

const AGENCY_URL = "https://app.mutav.finance";

function sessionWith(user: { email?: string }): SessionData {
  return {
    user: { sub: "auth0|test-subject", ...user },
    tokenSet: { accessToken: "access-token", idToken: "id-token", expiresAt: 0 },
    internal: { sid: "session-id", createdAt: 0 },
  };
}

describe("resolveAccessDeniedView", () => {
  describe("anonymous", () => {
    const view = resolveAccessDeniedView({
      gate: { kind: "anonymous" },
      locale: "pt-BR",
      agencyUrl: AGENCY_URL,
    });

    it("offers sign-in rather than sign-out", () => {
      expect(view.secondary).toEqual({ href: "/auth/login", labelKey: "signIn" });
    });

    it("still points at the agency app", () => {
      expect(view.primary).toEqual({
        href: "https://app.mutav.finance",
        labelKey: "goToAgency",
      });
    });

    it("carries no email, because there is no session to read one from", () => {
      expect(view.email).toBe("");
    });

    it("does not claim the visitor lacks access — they may be staff who is signed out", () => {
      expect(view.titleKey).toBe("anonymousTitle");
      expect(view.subtitleKey).toBe("anonymousSubtitle");
      expect(view.eyebrowKey).toBe("anonymousEyebrow");
    });

    it("marks the tone as signed-out so the page shows a sign-in marker", () => {
      expect(view.tone).toBe("signedOut");
    });
  });

  describe("not-staff", () => {
    const view = resolveAccessDeniedView({
      gate: { kind: "not-staff", session: sessionWith({ email: "someone@example.com" }) },
      locale: "pt-BR",
      agencyUrl: AGENCY_URL,
    });

    it("sends the user to the agency app", () => {
      expect(view.primary).toEqual({
        href: "https://app.mutav.finance",
        labelKey: "goToAgency",
      });
    });

    it("offers sign-out so a wrong-account login is recoverable", () => {
      expect(view.secondary).toEqual({ href: "/auth/logout", labelKey: "signOut" });
    });

    it("shows which account is signed in", () => {
      expect(view.email).toBe("someone@example.com");
    });

    it("uses the denial copy", () => {
      expect(view.titleKey).toBe("title");
      expect(view.subtitleKey).toBe("subtitle");
      expect(view.eyebrowKey).toBe("eyebrow");
    });

    it("marks the tone as denied", () => {
      expect(view.tone).toBe("denied");
    });

    it("prefixes the agency URL for a non-default locale", () => {
      const en = resolveAccessDeniedView({
        gate: { kind: "not-staff", session: sessionWith({ email: "someone@example.com" }) },
        locale: "en",
        agencyUrl: AGENCY_URL,
      });
      expect(en.primary.href).toBe("https://app.mutav.finance/en");
    });
  });

  describe("staff", () => {
    const staffGate: StaffGateResult = {
      kind: "staff",
      session: sessionWith({ email: "staff@mutav.finance" }),
      roles: ["admin"],
    };

    it("links back to the console instead of the agency app", () => {
      const view = resolveAccessDeniedView({
        gate: staffGate,
        locale: "pt-BR",
        agencyUrl: AGENCY_URL,
      });
      expect(view.primary).toEqual({ href: "/", labelKey: "goToAdmin" });
    });

    it("leaves the default locale unprefixed and prefixes the others", () => {
      const en = resolveAccessDeniedView({
        gate: staffGate,
        locale: "en",
        agencyUrl: AGENCY_URL,
      });
      expect(en.primary.href).toBe("/en");
    });

    it("does not claim the visitor was denied", () => {
      const view = resolveAccessDeniedView({
        gate: staffGate,
        locale: "pt-BR",
        agencyUrl: AGENCY_URL,
      });
      expect(view.titleKey).toBe("staffTitle");
      expect(view.subtitleKey).toBe("staffSubtitle");
      expect(view.eyebrowKey).toBe("staffEyebrow");
      expect(view.tone).toBe("granted");
    });
  });

  describe("email normalization", () => {
    it("trims whitespace-padded claims", () => {
      const view = resolveAccessDeniedView({
        gate: { kind: "not-staff", session: sessionWith({ email: "  spaced@example.com  " }) },
        locale: "pt-BR",
        agencyUrl: AGENCY_URL,
      });
      expect(view.email).toBe("spaced@example.com");
    });

    it("collapses a whitespace-only claim to empty so the line is suppressed", () => {
      const view = resolveAccessDeniedView({
        gate: { kind: "not-staff", session: sessionWith({ email: "   " }) },
        locale: "pt-BR",
        agencyUrl: AGENCY_URL,
      });
      expect(view.email).toBe("");
    });

    it("handles a session with no email claim at all", () => {
      const view = resolveAccessDeniedView({
        gate: { kind: "not-staff", session: sessionWith({}) },
        locale: "pt-BR",
        agencyUrl: AGENCY_URL,
      });
      expect(view.email).toBe("");
    });
  });
});
