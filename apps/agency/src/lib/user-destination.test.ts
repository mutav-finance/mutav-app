import { describe, expect, it, vi } from "vitest";
import {
  resolveUserDestinationWith,
  shouldRouteStaffToAdmin,
  type UserDestinationDeps,
} from "./user-destination";

describe("shouldRouteStaffToAdmin", () => {
  it("routes a staff user with no active agency to admin", () => {
    expect(shouldRouteStaffToAdmin({ isStaff: true, agencies: [] })).toBe(true);
    expect(
      shouldRouteStaffToAdmin({
        isStaff: true,
        agencies: [{ onboardingState: "under_review" }],
      }),
    ).toBe(true);
  });

  it("keeps a staff user WITH an active agency on the dashboard (Phase E shell-switcher)", () => {
    expect(
      shouldRouteStaffToAdmin({
        isStaff: true,
        agencies: [{ onboardingState: "active" }],
      }),
    ).toBe(false);
    expect(
      shouldRouteStaffToAdmin({
        isStaff: true,
        agencies: [{ onboardingState: "under_review" }, { onboardingState: "active" }],
      }),
    ).toBe(false);
  });

  it("never routes a non-staff user to admin, regardless of agency state", () => {
    expect(shouldRouteStaffToAdmin({ isStaff: false, agencies: [] })).toBe(false);
    expect(
      shouldRouteStaffToAdmin({
        isStaff: false,
        agencies: [{ onboardingState: "active" }],
      }),
    ).toBe(false);
    expect(
      shouldRouteStaffToAdmin({
        isStaff: false,
        agencies: [{ onboardingState: "under_review" }],
      }),
    ).toBe(false);
  });
});

type Agencies = ReadonlyArray<{ onboardingState?: string }>;

const ME = { _id: "user-1" };
const PROVISIONED = { success: true, data: {}, message: "ok" } as const;

function refused(code: string) {
  return { success: false, error: { code }, message: "secret refusal detail" } as const;
}

/**
 * Every dependency succeeds by default and lands on `dashboard`; each test
 * overrides the one step it is about.
 */
function depsWith(overrides: Partial<UserDestinationDeps> = {}) {
  const provision = vi.fn<UserDestinationDeps["provision"]>(async () => PROVISIONED);
  const log = vi.fn<UserDestinationDeps["log"]>();
  const deps: UserDestinationDeps = {
    readToken: async () => ({ kind: "token", token: "id-token" }),
    fetchMe: async () => ME,
    provision,
    fetchAgencies: async (): Promise<Agencies> => [{ onboardingState: "active" }],
    fetchStaff: async () => false,
    log,
    ...overrides,
  };
  return { deps, provision: deps.provision, log };
}

function transportError(): TypeError {
  return new TypeError("fetch failed");
}

describe("resolveUserDestinationWith", () => {
  describe("session", () => {
    it.each([
      { kind: "none" as const },
      { kind: "expired" as const },
      { kind: "refresh-failed" as const, code: "id_token_not_renewed" },
    ])("maps a $kind token read to session-expired", async (token) => {
      const { deps } = depsWith({ readToken: async () => token });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "session-expired" });
    });

    it("does not touch the backend when there is no usable token", async () => {
      const fetchMe = vi.fn<UserDestinationDeps["fetchMe"]>(async () => ME);
      const { deps } = depsWith({ readToken: async () => ({ kind: "none" }), fetchMe });
      await resolveUserDestinationWith(deps);
      expect(fetchMe).not.toHaveBeenCalled();
    });
  });

  describe("user row", () => {
    it("maps a getMe throw to backend-unavailable, without provisioning", async () => {
      const { deps, provision } = depsWith({
        fetchMe: async () => {
          throw new Error("Server Error");
        },
      });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "backend-unavailable" });
      expect(provision).not.toHaveBeenCalled();
    });

    it("provisions exactly once when the row is missing, then continues", async () => {
      const fetchMe = vi
        .fn<UserDestinationDeps["fetchMe"]>()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(ME);
      const { deps, provision } = depsWith({ fetchMe });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "dashboard" });
      expect(provision).toHaveBeenCalledTimes(1);
      expect(fetchMe).toHaveBeenCalledTimes(2);
    });

    it("maps a row still missing after provisioning to not-provisioned", async () => {
      const { deps, provision } = depsWith({ fetchMe: async () => null });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "not-provisioned" });
      expect(provision).toHaveBeenCalledTimes(1);
    });

    it("maps an application error from provisioning to not-provisioned", async () => {
      const { deps, provision } = depsWith({
        fetchMe: async () => null,
        provision: vi.fn(async () => {
          throw new Error("Auth0 identity is missing the email claim");
        }),
      });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "not-provisioned" });
      expect(provision).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["EMAIL_NOT_VERIFIED", "email-not-verified"],
      ["EMAIL_BOUND_TO_OTHER_IDENTITY", "email-bound"],
    ])("maps a %s refusal to not-provisioned with reason %s", async (code, reason) => {
      const fetchMe = vi.fn<UserDestinationDeps["fetchMe"]>(async () => null);
      const { deps, log } = depsWith({ fetchMe, provision: vi.fn(async () => refused(code)) });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "not-provisioned", reason });
      expect(fetchMe).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("provision", { code });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    });

    it("maps an unknown refusal code to plain not-provisioned", async () => {
      const { deps, log } = depsWith({
        fetchMe: async () => null,
        provision: vi.fn(async () => refused("SOMETHING_NEW")),
      });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "not-provisioned" });
      expect(log).toHaveBeenCalledWith("provision", { code: "SOMETHING_NEW" });
    });

    it("maps a transport error from provisioning to backend-unavailable", async () => {
      const { deps, provision } = depsWith({
        fetchMe: async () => null,
        provision: vi.fn(async () => {
          throw transportError();
        }),
      });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "backend-unavailable" });
      expect(provision).toHaveBeenCalledTimes(1);
    });

    it("maps a getMe throw after provisioning to backend-unavailable", async () => {
      const fetchMe = vi
        .fn<UserDestinationDeps["fetchMe"]>()
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(transportError());
      const { deps, provision } = depsWith({ fetchMe });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "backend-unavailable" });
      expect(provision).toHaveBeenCalledTimes(1);
    });
  });

  describe("agencies and staff", () => {
    it("maps an agencies fetch throw to backend-unavailable", async () => {
      const { deps } = depsWith({
        fetchAgencies: async () => {
          throw new Error("Server Error");
        },
      });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "backend-unavailable" });
    });

    it("never yields dashboard when the staff fetch fails, even with an active agency", async () => {
      const { deps } = depsWith({
        fetchAgencies: async () => [{ onboardingState: "active" }],
        fetchStaff: async () => {
          throw transportError();
        },
      });
      const destination = await resolveUserDestinationWith(deps);
      expect(destination.kind).not.toBe("dashboard");
      expect(destination).toEqual({ kind: "backend-unavailable" });
    });

    it("routes staff with no active agency to the admin app", async () => {
      const { deps } = depsWith({ fetchAgencies: async () => [], fetchStaff: async () => true });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "staff" });
    });

    it.each([
      { agencies: [], expected: { kind: "onboarding-welcome" } },
      { agencies: [{ onboardingState: "active" }], expected: { kind: "dashboard" } },
      {
        agencies: [{ onboardingState: "under_review" }],
        expected: { kind: "onboarding-status", state: "under_review" },
      },
      {
        agencies: [{ onboardingState: "submitted" }],
        expected: { kind: "onboarding-status", state: "submitted" },
      },
      { agencies: [{ onboardingState: "rejected" }], expected: { kind: "onboarding-rejected" } },
      { agencies: [{ onboardingState: "in_progress" }], expected: { kind: "onboarding-welcome" } },
    ])("maps agencies $agencies to $expected.kind", async ({ agencies, expected }) => {
      const { deps } = depsWith({ fetchAgencies: async () => agencies });
      expect(await resolveUserDestinationWith(deps)).toEqual(expected);
    });
  });

  describe("logging", () => {
    it("logs one line with only the error name per failure", async () => {
      const { deps, log } = depsWith({
        fetchAgencies: async () => {
          throw new TypeError("secret detail that must not be logged");
        },
      });
      await resolveUserDestinationWith(deps);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith("fetchAgencies", { name: "TypeError", kind: "transport" });
    });

    it("logs the error kind with the name, never the message", async () => {
      const { deps, log } = depsWith({
        fetchMe: async () => {
          throw new Error('{"code":"InvalidAuthHeader","message":"secret jwt detail"}');
        },
      });
      await resolveUserDestinationWith(deps);
      expect(log).toHaveBeenCalledWith("getMe", { name: "Error", kind: "auth_rejected" });
      expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    });

    it("keeps routing an auth-rejected read to backend-unavailable, never to login", async () => {
      const { deps } = depsWith({
        fetchAgencies: async () => {
          throw new Error("Could not verify OIDC token claim");
        },
      });
      expect(await resolveUserDestinationWith(deps)).toEqual({ kind: "backend-unavailable" });
    });

    it("logs nothing on the happy path", async () => {
      const { deps, log } = depsWith();
      await resolveUserDestinationWith(deps);
      expect(log).not.toHaveBeenCalled();
    });
  });
});
