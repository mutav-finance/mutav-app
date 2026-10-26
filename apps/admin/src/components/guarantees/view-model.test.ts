import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import {
  ACTIVATION_STEPS,
  activationStepPosition,
  baseUnitsToCents,
  errorMessageKey,
  isActivationTab,
  isTxSignatureInput,
  outcomeForRegistration,
  outcomeForThrownRegistration,
  REGISTRATION_BLOCKERS,
  REGISTRATION_ERROR_CODES,
} from "./view-model";

describe("activationStepPosition", () => {
  it.each([
    ["drafted", "editing", 1],
    ["drafted", "analysis_requested", 2],
    ["drafted", "accepted", 3],
    ["drafted", "awaiting_signature", 4],
    ["drafted", "signed", 5],
    ["drafted", "pending_registration", 6],
    ["active", "pending_registration", 7],
    ["in_arrears", "pending_registration", 7],
    ["closed", "refused", 2],
  ] as const)("%s + %s → step %i", (status, review, position) => {
    expect(activationStepPosition({ status, review })).toBe(position);
  });

  it("ends Signed → Waiting for reserve → Active", () => {
    expect(ACTIVATION_STEPS.slice(-3)).toEqual(["signed", "pending_registration", "active"]);
  });
});

describe("isActivationTab", () => {
  it("accepts the two queue tabs and nothing else", () => {
    expect(isActivationTab("pending_registration")).toBe(true);
    expect(isActivationTab("awaiting_signature")).toBe(true);
    expect(isActivationTab("signed")).toBe(false);
    expect(isActivationTab("accepted")).toBe(false);
  });
});

describe("registration outcomes", () => {
  it("maps success to the registered toast", () => {
    expect(outcomeForRegistration({ success: true })).toEqual({
      kind: "success",
      messageKey: "toast.registered",
    });
  });

  it("maps a reserve refusal to its own outcome, carrying the program error", () => {
    expect(
      outcomeForRegistration({
        success: false,
        error: { code: "REGISTRATION_REFUSED", programErrorName: "InsufficientFreeCapital" },
      }),
    ).toEqual({
      kind: "refused",
      messageKey: "toast.registrationRefused",
      programErrorName: "InsufficientFreeCapital",
    });
  });

  it.each([
    ["REVIEW_NOT_PENDING_REGISTRATION", "errors.REVIEW_NOT_PENDING_REGISTRATION"],
    ["RESERVE_READER_UNAVAILABLE", "errors.RESERVE_READER_UNAVAILABLE"],
    ["ARGS_MISMATCH", "errors.ARGS_MISMATCH"],
    ["SOMETHING_NEW", "errors.unexpected"],
  ])("maps %s to %s", (code, key) => {
    expect(errorMessageKey(code)).toBe(key);
    expect(outcomeForRegistration({ success: false, error: { code } })).toEqual({
      kind: "error",
      messageKey: key,
    });
  });

  it("names a thrown role gate as forbidden", () => {
    expect(outcomeForThrownRegistration(new Error("Requires 'compliance' role or higher"))).toEqual(
      {
        kind: "error",
        messageKey: "errors.FORBIDDEN",
      },
    );
    expect(outcomeForThrownRegistration(new Error("boom")).messageKey).toBe("errors.unexpected");
  });
});

describe("registration form helpers", () => {
  it.each([
    ["5".repeat(88), true],
    [` ${"5".repeat(87)} `, true],
    ["0".repeat(88), false],
    ["abc", false],
    ["", false],
  ])("%j is a tx signature = %s", (input, valid) => {
    expect(isTxSignatureInput(input)).toBe(valid);
  });

  it("converts base units to cents, rounding a fraction of a cent up", () => {
    expect(baseUnitsToCents("30000000000")).toBe(3_000_000);
    expect(baseUnitsToCents("10001")).toBe(2);
    expect(baseUnitsToCents("0")).toBe(0);
  });
});

describe("staffGuarantees messages", () => {
  it.each([
    ["en", en],
    ["pt-BR", ptBR],
  ] as const)(
    "%s carries a message for every registration code and blocker",
    (_locale, messages) => {
      const errors: Record<string, string> = messages.staffGuarantees.errors;
      for (const code of [...REGISTRATION_ERROR_CODES, "FORBIDDEN", "unexpected"]) {
        expect(errors[code]).toEqual(expect.any(String));
      }
      const blockers: Record<string, string> = messages.staffGuarantees.blockers;
      for (const blocker of REGISTRATION_BLOCKERS) {
        expect(blockers[blocker]).toEqual(expect.any(String));
      }
      const steps: Record<string, string> = messages.staffGuarantees.stepper.steps;
      for (const step of ACTIVATION_STEPS) {
        expect(steps[step]).toEqual(expect.any(String));
      }
    },
  );
});
