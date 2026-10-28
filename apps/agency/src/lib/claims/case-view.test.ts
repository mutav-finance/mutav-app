import { describe, expect, test } from "vitest";
import { caseEvents, caseStep, liveCaseStatus, nextStepFor } from "./case-view";

describe("liveCaseStatus", () => {
  test.each([
    ["reported", "2026-10-15", "2026-10-14", "reported"],
    ["reported", "2026-10-15", "2026-10-15", "ready_to_claim"],
    ["ready_to_claim", "2026-10-15", "2026-10-20", "ready_to_claim"],
    ["under_review", "2026-10-15", "2026-10-01", "under_review"],
    ["paid", "2026-10-15", "2026-10-01", "paid"],
  ] as const)("%s, claimable %s, today %s → %s", (caseStatus, claimableFrom, today, expected) => {
    expect(liveCaseStatus({ caseStatus, claimableFrom }, today)).toBe(expected);
  });
});

describe("caseStep", () => {
  test.each([
    ["reported", 1],
    ["ready_to_claim", 2],
    ["under_review", 3],
    ["info_requested", 3],
    ["approved", 4],
    ["paid", 5],
    ["cured", null],
    ["refused", null],
  ] as const)("%s → %s", (status, step) => {
    expect(caseStep(status)).toBe(step);
  });
});

describe("nextStepFor", () => {
  test("names whose turn it is", () => {
    const base = { claimableFrom: "2026-10-15", requestDueAt: "2026-10-29" };
    expect(nextStepFor({ ...base, status: "reported" })).toEqual({
      key: "waitUntil",
      date: "2026-10-15",
    });
    expect(nextStepFor({ ...base, status: "ready_to_claim" })).toEqual({ key: "fileClaim" });
    expect(nextStepFor({ ...base, status: "info_requested" })).toEqual({
      key: "answerRequest",
      date: "2026-10-29",
    });
    expect(nextStepFor({ ...base, status: "approved" })).toEqual({ key: "awaitingPayment" });
    expect(nextStepFor({ ...base, status: "withdrawn" })).toEqual({ key: "none" });
  });
});

describe("caseEvents", () => {
  test("orders the case's own history newest first", () => {
    expect(
      caseEvents({
        openedAt: "2026-10-08T09:40:00.000Z",
        verifiedAt: "2026-10-27T10:58:00.000Z",
        claim: {
          submittedAt: "2026-10-24T10:15:00.000Z",
          requests: [{ requestedAt: "2026-10-26T14:02:00.000Z" }],
        },
        resolution: { kind: "cover_committed", resolvedAt: "2026-10-28T11:03:00.000Z" },
        cancellation: null,
        cover: { executedAt: "2026-10-30T16:20:00.000Z" },
      }).map((event) => event.key),
    ).toEqual(["paid", "covered", "verified", "infoRequested", "claimed", "reported"]);
  });
});
