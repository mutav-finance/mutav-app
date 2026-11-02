import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import {
  ACTIVATION_BLOCKERS,
  ACTIVATION_ERROR_CODES,
  ACTIVATION_STEPS,
  activationStepPosition,
  activationSteps,
  errorMessageKey,
  isActivationTab,
  outcomeForRetry,
  outcomeForThrownRetry,
} from "./view-model";

describe("activationSteps", () => {
  it("draws Signed → Active when the guarantee never waited", () => {
    expect(activationSteps({ status: "active", review: "signed" }).slice(-2)).toEqual([
      "signed",
      "active",
    ]);
  });

  it("draws Signed → Waiting for reserve → Active while it waits", () => {
    expect(activationSteps({ status: "drafted", review: "awaiting_capacity" }).slice(-3)).toEqual([
      "signed",
      "awaiting_capacity",
      "active",
    ]);
  });
});

describe("activationStepPosition", () => {
  it.each([
    ["drafted", "editing", 1],
    ["drafted", "analysis_requested", 2],
    ["drafted", "accepted", 3],
    ["drafted", "awaiting_signature", 4],
    ["drafted", "signed", 5],
    ["drafted", "awaiting_capacity", 6],
    ["active", "signed", 6],
    ["in_arrears", "signed", 6],
    ["closed", "refused", 2],
  ] as const)("%s + %s → step %i", (status, review, position) => {
    expect(activationStepPosition({ status, review })).toBe(position);
  });
});

describe("isActivationTab", () => {
  it("accepts the two queue tabs and nothing else", () => {
    expect(isActivationTab("awaiting_capacity")).toBe(true);
    expect(isActivationTab("awaiting_signature")).toBe(true);
    expect(isActivationTab("signed")).toBe(false);
    expect(isActivationTab("pending_registration")).toBe(false);
  });
});

describe("activation retry outcomes", () => {
  it("activated → the success toast", () => {
    expect(outcomeForRetry({ success: true, data: { outcome: "activated" } })).toEqual({
      kind: "activated",
      messageKey: "toast.activated",
    });
  });

  it("still short → keeps waiting, with the shortfall", () => {
    expect(
      outcomeForRetry({
        success: true,
        data: {
          outcome: "awaiting_capacity",
          reason: "INSUFFICIENT_FREE_CAPITAL",
          shortfallCents: 40_000,
        },
      }),
    ).toEqual({ kind: "waiting", messageKey: "toast.stillWaiting", shortfallCents: 40_000 });
  });

  it("no fresh balance → keeps waiting, the reserve unreadable", () => {
    expect(
      outcomeForRetry({
        success: true,
        data: {
          outcome: "awaiting_capacity",
          reason: "RESERVE_BALANCE_UNAVAILABLE",
          shortfallCents: null,
        },
      }),
    ).toEqual({ kind: "waiting", messageKey: "toast.reserveUnavailable", shortfallCents: null });
  });

  it.each([
    ["REVIEW_NOT_SIGNED", "errors.REVIEW_NOT_SIGNED"],
    ["AGENCY_NOT_ACTIVE", "errors.AGENCY_NOT_ACTIVE"],
    ["SOMETHING_NEW", "errors.unexpected"],
  ])("%s → %s", (code, key) => {
    expect(outcomeForRetry({ success: false, error: { code } })).toEqual({
      kind: "error",
      messageKey: key,
    });
    expect(errorMessageKey(code)).toBe(key);
  });

  it("a role refusal thrown by the wrapper reads as FORBIDDEN", () => {
    expect(outcomeForThrownRetry(new Error("Requires 'compliance' role or higher"))).toEqual({
      kind: "error",
      messageKey: "errors.FORBIDDEN",
    });
    expect(outcomeForThrownRetry(new Error("boom")).messageKey).toBe("errors.unexpected");
  });
});

describe("staffGuarantees messages", () => {
  it.each([
    ["en", en],
    ["pt-BR", ptBR],
  ] as const)("%s carries a message for every activation code, blocker and step", (_locale, m) => {
    const errors: Record<string, string> = m.staffGuarantees.errors;
    for (const code of [...ACTIVATION_ERROR_CODES, "FORBIDDEN", "unexpected"]) {
      expect(errors[code]).toEqual(expect.any(String));
    }
    const blockers: Record<string, string> = m.staffGuarantees.blockers;
    for (const blocker of ACTIVATION_BLOCKERS) {
      expect(blockers[blocker]).toEqual(expect.any(String));
    }
    const steps: Record<string, string> = m.staffGuarantees.stepper.steps;
    for (const step of ACTIVATION_STEPS) {
      expect(steps[step]).toEqual(expect.any(String));
    }
  });
});
