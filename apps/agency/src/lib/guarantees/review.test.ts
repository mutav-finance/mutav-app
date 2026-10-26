import { describe, expect, it } from "vitest";
import {
  bpsToPercent,
  canRequestAnalysis,
  currentReviewStep,
  isWaitingForReserveCapacity,
  requestAnalysisErrorKey,
  reviewStepper,
  showsReviewCard,
} from "./review";

describe("reviewStepper", () => {
  it("marks the current step and everything before it done", () => {
    expect(reviewStepper("accepted")).toEqual({
      steps: [
        { step: "editing", state: "done" },
        { step: "analysis_requested", state: "done" },
        { step: "accepted", state: "current" },
        { step: "awaiting_signature", state: "upcoming" },
        { step: "signed", state: "upcoming" },
        { step: "pending_registration", state: "upcoming" },
        { step: "active", state: "upcoming" },
      ],
      refused: false,
    });
  });

  it("ends Signed → Waiting for reserve → Active", () => {
    expect(reviewStepper("pending_registration").steps.slice(-3)).toEqual([
      { step: "signed", state: "done" },
      { step: "pending_registration", state: "current" },
      { step: "active", state: "upcoming" },
    ]);
  });

  it("an activated guarantee ends the road at active", () => {
    expect(reviewStepper("active").steps.map((step) => step.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
      "done",
      "current",
    ]);
  });

  it("starts a fresh draft at editing", () => {
    expect(reviewStepper("editing").steps[0]).toEqual({ step: "editing", state: "current" });
  });

  it("a refusal keeps the request done and flags the rest refused", () => {
    expect(reviewStepper("refused")).toEqual({
      steps: [
        { step: "editing", state: "done" },
        { step: "analysis_requested", state: "done" },
        { step: "accepted", state: "upcoming" },
        { step: "awaiting_signature", state: "upcoming" },
        { step: "signed", state: "upcoming" },
        { step: "pending_registration", state: "upcoming" },
        { step: "active", state: "upcoming" },
      ],
      refused: true,
    });
  });
});

describe("currentReviewStep", () => {
  it.each([
    ["drafted", "awaiting_signature", "awaiting_signature"],
    ["drafted", "pending_registration", "pending_registration"],
    ["active", "pending_registration", "active"],
    ["closed", "refused", "refused"],
  ] as const)("%s + %s → %s", (status, review, expected) => {
    expect(currentReviewStep({ status, review })).toBe(expected);
  });
});

describe("canRequestAnalysis / showsReviewCard", () => {
  it.each([
    ["drafted", "editing", true],
    ["drafted", "analysis_requested", false],
    ["drafted", "accepted", false],
    ["closed", "editing", false],
  ] as const)("%s + %s → request allowed %s", (status, review, expected) => {
    expect(canRequestAnalysis({ status, review })).toBe(expected);
  });

  it.each([
    ["drafted", "awaiting_signature", true],
    ["closed", "refused", true],
    ["closed", "editing", false],
    ["active", "signed", true],
    ["in_arrears", "signed", false],
  ] as const)("%s + %s → card shown %s", (status, review, expected) => {
    expect(showsReviewCard({ status, review })).toBe(expected);
  });
});

describe("bpsToPercent", () => {
  it("converts basis points to a percent number", () => {
    expect(bpsToPercent(1_300)).toBe(13);
    expect(bpsToPercent(1_250)).toBe(12.5);
  });
});

describe("requestAnalysisErrorKey", () => {
  it("maps known codes and falls back to UNEXPECTED", () => {
    expect(requestAnalysisErrorKey("NOT_EDITING")).toBe("errors.NOT_EDITING");
    expect(requestAnalysisErrorKey("CREDIT_ASSESSMENT_REQUIRED")).toBe(
      "errors.CREDIT_ASSESSMENT_REQUIRED",
    );
    expect(requestAnalysisErrorKey("SOMETHING_ELSE")).toBe("errors.UNEXPECTED");
  });
});

describe("isWaitingForReserveCapacity", () => {
  it.each([
    ["drafted", "pending_registration", "2026-10-20T12:00:00.000Z", true],
    ["drafted", "pending_registration", null, false],
    ["drafted", "awaiting_signature", "2026-10-20T12:00:00.000Z", false],
    ["active", "pending_registration", "2026-10-20T12:00:00.000Z", false],
  ] as const)("%s + %s + refusedAt %s → %s", (status, review, reserveRefusedAt, expected) => {
    expect(isWaitingForReserveCapacity({ status, review, reserveRefusedAt })).toBe(expected);
  });
});
