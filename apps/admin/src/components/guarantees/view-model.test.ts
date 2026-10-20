import { describe, expect, it } from "vitest";
import en from "../../../messages/en.json";
import ptBR from "../../../messages/pt-BR.json";
import {
  ACTIVATION_ERROR_CODES,
  activationStepPosition,
  errorMessageKey,
  isActivationTab,
  outcomeForActivation,
  outcomeForThrownActivation,
} from "./view-model";

describe("activationStepPosition", () => {
  it.each([
    ["drafted", "editing", 1],
    ["drafted", "analysis_requested", 2],
    ["drafted", "accepted", 3],
    ["drafted", "awaiting_signature", 4],
    ["drafted", "signed", 5],
    ["active", "signed", 6],
    ["in_arrears", "signed", 6],
    ["closed", "refused", 2],
  ] as const)("%s + %s → step %i", (status, review, position) => {
    expect(activationStepPosition({ status, review })).toBe(position);
  });
});

describe("isActivationTab", () => {
  it("accepts the two queue tabs and nothing else", () => {
    expect(isActivationTab("signed")).toBe(true);
    expect(isActivationTab("awaiting_signature")).toBe(true);
    expect(isActivationTab("accepted")).toBe(false);
  });
});

describe("activation outcomes", () => {
  it("maps success to the activated toast", () => {
    expect(outcomeForActivation({ success: true })).toEqual({
      kind: "success",
      messageKey: "toast.activated",
    });
  });

  it.each([
    ["REVIEW_NOT_SIGNED", "errors.REVIEW_NOT_SIGNED"],
    ["SIGNED_CONTRACT_NOT_APPROVED", "errors.SIGNED_CONTRACT_NOT_APPROVED"],
    ["AGENCY_NOT_ACTIVE", "errors.AGENCY_NOT_ACTIVE"],
    ["SOMETHING_NEW", "errors.unexpected"],
  ])("maps %s to %s", (code, key) => {
    expect(errorMessageKey(code)).toBe(key);
    expect(outcomeForActivation({ success: false, error: { code } })).toEqual({
      kind: "error",
      messageKey: key,
    });
  });

  it("names a thrown role gate as forbidden", () => {
    expect(outcomeForThrownActivation(new Error("Requires 'compliance' role or higher"))).toEqual({
      kind: "error",
      messageKey: "errors.FORBIDDEN",
    });
    expect(outcomeForThrownActivation(new Error("boom")).messageKey).toBe("errors.unexpected");
  });
});

describe("staffGuarantees messages", () => {
  it.each([
    ["en", en],
    ["pt-BR", ptBR],
  ] as const)("%s carries a message for every activation error code", (_locale, messages) => {
    const errors: Record<string, string> = messages.staffGuarantees.errors;
    for (const code of [...ACTIVATION_ERROR_CODES, "FORBIDDEN", "unexpected"]) {
      expect(errors[code]).toEqual(expect.any(String));
    }
  });
});
