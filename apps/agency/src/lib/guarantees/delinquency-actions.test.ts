import { describe, expect, it } from "vitest";
import type { CloseReason, GuaranteeState } from "@convex/guarantees/domain";
import { guaranteeDelinquencyActions } from "./delinquency-actions";

function closureFor(reason: CloseReason) {
  return { reason, closedAt: "2026-09-01T00:00:00.000Z" };
}

function actionsFor(status: GuaranteeState, closeReason?: CloseReason) {
  return guaranteeDelinquencyActions({
    id: "1000040",
    status,
    closure: closeReason === undefined ? null : closureFor(closeReason),
  });
}

describe("guaranteeDelinquencyActions", () => {
  it.each<GuaranteeState>([
    "active",
    "in_arrears",
    "default_verified",
    "cover_committed",
    "in_eviction",
  ])("%s → open enabled, track links to the guarantee-filtered list", (status) => {
    expect(actionsFor(status)).toEqual({
      open: { enabled: true },
      track: { enabled: true, href: "/delinquencies?guarantee=1000040" },
    });
  });

  it("drafted → both disabled (never in force, so no notices can exist)", () => {
    expect(actionsFor("drafted")).toEqual({
      open: { enabled: false, reason: "notInForce" },
      track: { enabled: false, reason: "neverInForce" },
    });
  });

  it.each<CloseReason>(["end_of_lease", "rescission", "abandonment", "death", "eviction"])(
    "closed (%s) → open disabled, track still links to the notice history",
    (reason) => {
      expect(actionsFor("closed", reason)).toEqual({
        open: { enabled: false, reason: "notInForce" },
        track: { enabled: true, href: "/delinquencies?guarantee=1000040" },
      });
    },
  );

  it("closed (dispute_reversal) → open disabled, track enabled", () => {
    expect(actionsFor("closed", "dispute_reversal")).toEqual({
      open: { enabled: false, reason: "notInForce" },
      track: { enabled: true, href: "/delinquencies?guarantee=1000040" },
    });
  });

  it("closed (canceled_pre_activation) → both disabled (was only ever a draft)", () => {
    expect(actionsFor("closed", "canceled_pre_activation")).toEqual({
      open: { enabled: false, reason: "notInForce" },
      track: { enabled: false, reason: "neverInForce" },
    });
  });

  it("encodes the guarantee id in the track href", () => {
    const actions = guaranteeDelinquencyActions({
      id: "A B&1",
      status: "active",
      closure: null,
    });
    expect(actions.track).toEqual({
      enabled: true,
      href: "/delinquencies?guarantee=A+B%261",
    });
  });
});
