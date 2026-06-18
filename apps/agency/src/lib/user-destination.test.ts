import { describe, expect, it } from "vitest";
import { shouldRouteStaffToAdmin } from "./user-destination";

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
