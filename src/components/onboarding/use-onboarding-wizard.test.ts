import { describe, expect, it } from "vitest";
import { wizardReducer } from "@/components/onboarding/use-onboarding-wizard";
import type { AgencyId } from "@convex/agencies/domain";

// wizardReducer is pure — no React, no Convex. Tests run in plain node env.
// Synthetic Ids for a pure-reducer test — opaque convex-test Ids aren't
// reachable here. Boundary exception per CLAUDE.md.
const AGENCY_ID = "agencies_test_1" as AgencyId;
const AGENCY_ID_2 = "agencies_test_2" as AgencyId;

function makeInitialState() {
  return {
    step: 1,
    agencyId: null,
    data: {
      agencyType: "" as const,
      name: "",
      email: "",
      phone: "",
      creci: "",
      cpf: "",
      cnpj: "",
      representanteName: "",
      representanteCpf: "",
      bankName: "",
      bankBranch: "",
      bankAccount: "",
      bankAccountType: "" as const,
      bankPixKey: "",
    },
    submitState: "idle" as const,
    errorCode: null,
  };
}

describe("wizardReducer", () => {
  describe("PATCH", () => {
    it("merges partial data without clobbering other fields", () => {
      const state = makeInitialState();
      const next = wizardReducer(state, {
        type: "PATCH",
        patch: { name: "Acme", email: "a@b.co" },
      });
      expect(next.data.name).toBe("Acme");
      expect(next.data.email).toBe("a@b.co");
      expect(next.data.phone).toBe("");
    });

    it("does not mutate the previous state object", () => {
      const state = makeInitialState();
      wizardReducer(state, { type: "PATCH", patch: { name: "X" } });
      expect(state.data.name).toBe("");
    });
  });

  describe("GO_TO", () => {
    it("sets step to the requested value without touching data", () => {
      const state = { ...makeInitialState(), step: 2 };
      const next = wizardReducer(state, { type: "GO_TO", step: 4 });
      expect(next.step).toBe(4);
      expect(next.data).toEqual(state.data);
    });
  });

  describe("SUBMIT_START", () => {
    it("flips submitState to submitting and clears prior error", () => {
      const state = {
        ...makeInitialState(),
        submitState: "idle" as const,
        errorCode: "CPF_INVALID",
      };
      const next = wizardReducer(state, { type: "SUBMIT_START" });
      expect(next.submitState).toBe("submitting");
      expect(next.errorCode).toBe(null);
    });
  });

  describe("SUBMIT_SUCCESS", () => {
    it("advances step + 1 and persists agencyId when provided", () => {
      const state = { ...makeInitialState(), step: 1, submitState: "submitting" as const };
      const next = wizardReducer(state, { type: "SUBMIT_SUCCESS", agencyId: AGENCY_ID });
      expect(next.step).toBe(2);
      expect(next.agencyId).toBe(AGENCY_ID);
      expect(next.submitState).toBe("idle");
    });

    it("preserves existing agencyId when none provided (mid-flow advance)", () => {
      const state = {
        ...makeInitialState(),
        step: 2,
        agencyId: AGENCY_ID,
        submitState: "submitting" as const,
      };
      const next = wizardReducer(state, { type: "SUBMIT_SUCCESS" });
      expect(next.step).toBe(3);
      expect(next.agencyId).toBe(AGENCY_ID);
    });

    it("overwrites agencyId if a different one comes in", () => {
      const state = { ...makeInitialState(), agencyId: AGENCY_ID };
      const next = wizardReducer(state, { type: "SUBMIT_SUCCESS", agencyId: AGENCY_ID_2 });
      expect(next.agencyId).toBe(AGENCY_ID_2);
    });
  });

  describe("SUBMIT_DONE", () => {
    it("transitions to submitted terminal state", () => {
      const state = { ...makeInitialState(), submitState: "submitting" as const };
      const next = wizardReducer(state, { type: "SUBMIT_DONE" });
      expect(next.submitState).toBe("submitted");
      expect(next.errorCode).toBe(null);
    });
  });

  describe("SUBMIT_ERROR", () => {
    it("returns to idle and surfaces the error code", () => {
      const state = { ...makeInitialState(), submitState: "submitting" as const };
      const next = wizardReducer(state, { type: "SUBMIT_ERROR", code: "ALREADY_REGISTERED" });
      expect(next.submitState).toBe("idle");
      expect(next.errorCode).toBe("ALREADY_REGISTERED");
    });

    it("does not advance step on error (stays where the user was)", () => {
      const state = { ...makeInitialState(), step: 2, submitState: "submitting" as const };
      const next = wizardReducer(state, { type: "SUBMIT_ERROR", code: "INTERNAL_ERROR" });
      expect(next.step).toBe(2);
    });
  });

  describe("error → retry → success flow", () => {
    it("clears error on next SUBMIT_START and lands on next step on SUCCESS", () => {
      const s0 = makeInitialState();
      const s1 = wizardReducer(s0, { type: "SUBMIT_ERROR", code: "CPF_REQUIRED" });
      expect(s1.errorCode).toBe("CPF_REQUIRED");

      const s2 = wizardReducer(s1, { type: "SUBMIT_START" });
      expect(s2.errorCode).toBe(null);
      expect(s2.submitState).toBe("submitting");

      const s3 = wizardReducer(s2, { type: "SUBMIT_SUCCESS", agencyId: AGENCY_ID });
      expect(s3.errorCode).toBe(null);
      expect(s3.agencyId).toBe(AGENCY_ID);
      expect(s3.step).toBe(2);
    });
  });
});
