import { describe, expect, it } from "vitest";
import type { GuaranteeState } from "@convex/guarantees/domain";
import { claimHrefFor, reportLateRentAction } from "./delinquency-actions";

describe("reportLateRentAction", () => {
  it.each<GuaranteeState>([
    "active",
    "in_arrears",
    "default_verified",
    "cover_committed",
    "in_eviction",
  ])("%s → enabled", (status) => {
    expect(reportLateRentAction({ status })).toEqual({ enabled: true });
  });

  it.each<GuaranteeState>(["drafted", "closed"])("%s → disabled, not in force", (status) => {
    expect(reportLateRentAction({ status })).toEqual({ enabled: false, reason: "notInForce" });
  });
});

describe("claimHrefFor", () => {
  it("opens the case in the claims queue", () => {
    expect(claimHrefFor("DN-1000040-2026-10-05")).toBe("/claims?case=DN-1000040-2026-10-05");
  });
});
