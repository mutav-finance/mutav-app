import { describe, expect, it, vi } from "vitest";
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { getStaffMemberWith, type StaffGateDeps } from "./staff-gate";

const SESSION: SessionData = {
  user: { sub: "auth0|test-subject", email: "someone@example.com" },
  tokenSet: { accessToken: "access-token", idToken: "id-token", expiresAt: 0 },
  internal: { sid: "session-id", createdAt: 0 },
};

/** Every dependency succeeds by default and yields `staff`. */
function depsWith(overrides: Partial<StaffGateDeps> = {}) {
  const log = vi.fn<StaffGateDeps["log"]>();
  const deps: StaffGateDeps = {
    getSession: async () => SESSION,
    readToken: async () => ({ kind: "token", token: "fresh-id-token" }),
    fetchStaff: async () => ({ roles: ["reviewer"] }),
    log,
    ...overrides,
  };
  return { deps, log };
}

describe("getStaffMemberWith", () => {
  it("maps no session to anonymous", async () => {
    const { deps } = depsWith({ getSession: async () => null });
    expect(await getStaffMemberWith(deps)).toEqual({ kind: "anonymous" });
  });

  it("maps a session read throw to anonymous", async () => {
    const { deps } = depsWith({
      getSession: async () => {
        throw new Error("JWEDecryptionFailed");
      },
    });
    expect(await getStaffMemberWith(deps)).toEqual({ kind: "anonymous" });
  });

  it.each([
    { kind: "none" as const },
    { kind: "expired" as const },
    { kind: "refresh-failed" as const, code: "id_token_not_renewed" },
  ])("maps a $kind token read to anonymous", async (token) => {
    const fetchStaff = vi.fn<StaffGateDeps["fetchStaff"]>();
    const { deps } = depsWith({ readToken: async () => token, fetchStaff });
    expect(await getStaffMemberWith(deps)).toEqual({ kind: "anonymous" });
    expect(fetchStaff).not.toHaveBeenCalled();
  });

  it("maps a staff fetch throw to unavailable, not anonymous", async () => {
    const { deps, log } = depsWith({
      fetchStaff: async () => {
        throw new TypeError("fetch failed: detail that must not be logged");
      },
    });
    expect(await getStaffMemberWith(deps)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("getMyStaff", { name: "TypeError" });
  });

  it("lets Next control-flow signals through instead of mapping them", async () => {
    const signal = Object.assign(new Error("Dynamic server usage"), {
      digest: "DYNAMIC_SERVER_USAGE",
    });
    const { deps } = depsWith({
      fetchStaff: async () => {
        throw signal;
      },
    });
    await expect(getStaffMemberWith(deps)).rejects.toBe(signal);
  });

  it("maps no staff row to not-staff, carrying the session", async () => {
    const { deps } = depsWith({ fetchStaff: async () => null });
    expect(await getStaffMemberWith(deps)).toEqual({ kind: "not-staff", session: SESSION });
  });

  it("returns staff with the fresh token, roles and session", async () => {
    const fetchStaff = vi.fn<StaffGateDeps["fetchStaff"]>(async () => ({ roles: ["reviewer"] }));
    const { deps, log } = depsWith({ fetchStaff });
    expect(await getStaffMemberWith(deps)).toEqual({
      kind: "staff",
      session: SESSION,
      roles: ["reviewer"],
      token: "fresh-id-token",
    });
    expect(fetchStaff).toHaveBeenCalledWith("fresh-id-token");
    expect(log).not.toHaveBeenCalled();
  });
});
