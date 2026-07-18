import { describe, expect, it } from "vitest";
import { CONTRACT_STATUS, expiringRenewalBounds, getUrgencyTier } from "./domain";

const REFERENCE_DATE = "2026-07-18";

describe("getUrgencyTier", () => {
  it("returns inactive for encerrado regardless of date", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ENCERRADO,
        nextRenewalDate: "2026-08-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("inactive");
  });

  it("returns inactive for cancelado regardless of date", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.CANCELADO,
        nextRenewalDate: "2026-08-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("inactive");
  });

  it("returns pendente for pendente regardless of date", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.PENDENTE,
        nextRenewalDate: "2026-07-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("pendente");
  });

  it("returns overdue for an ativo contract renewing yesterday", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-07-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("overdue");
  });

  it("returns expiring at 0 days (today)", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-07-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("expiring");
  });

  it("returns expiring at 30 days (upper bound)", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-08-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("expiring");
  });

  it("returns critical at 31 days", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-08-18",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("critical");
  });

  it("returns critical at 60 days (upper bound)", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-09-16",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("critical");
  });

  it("returns warning at 61 days", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-09-17",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("warning");
  });

  it("returns warning at 120 days (upper bound)", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-11-15",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("warning");
  });

  it("returns ok at 121 days", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "2026-11-16",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("ok");
  });

  it("returns inactive for an unparseable renewal date", () => {
    expect(
      getUrgencyTier({
        status: CONTRACT_STATUS.ATIVO,
        nextRenewalDate: "not-a-date",
        referenceDate: REFERENCE_DATE,
      }),
    ).toBe("inactive");
  });
});

describe("expiringRenewalBounds", () => {
  it("spans [today, today + 60 days] in UTC YYYY-MM-DD", () => {
    expect(expiringRenewalBounds(REFERENCE_DATE)).toEqual({
      gte: "2026-07-18",
      lte: "2026-09-16",
    });
  });
});
