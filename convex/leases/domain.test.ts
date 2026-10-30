import { describe, expect, test } from "vitest";
import {
  buildLeaseRent,
  dueDateFor,
  isValidRentInput,
  latestDueDateOnOrBefore,
  ufFromCityUF,
} from "./domain";

describe("ufFromCityUF", () => {
  test.each([
    ["Porto Alegre/RS", "RS"],
    ["Porto Alegre / RS", "RS"],
    ["porto alegre/rs", "RS"],
    ["Rio de Janeiro/RJ", "RJ"],
    ["/RS", "RS"],
    ["Santana/Livramento/RS", "RS"],
    ["Brasília", null],
    ["Porto Alegre/", null],
    ["Porto Alegre/RSS", null],
    ["Porto Alegre/1A", null],
    ["", null],
    ["Porto Alegre/R S", null],
  ])("%j → %j", (cityUF, expected) => {
    expect(ufFromCityUF(cityUF)).toBe(expected);
  });
});

describe("isValidRentInput", () => {
  test.each([
    [{ rentCents: 1, condoCents: 0, otherFeesCents: 0, dueDay: 5 }, true],
    [{ rentCents: 100_000, condoCents: 45_000, otherFeesCents: 12_000, dueDay: 5 }, true],
    [{ rentCents: 0, condoCents: 0, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: -100, condoCents: 0, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: 1000.5, condoCents: 0, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: 100_000, condoCents: -1, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: 100_000, condoCents: 10.5, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: -1, dueDay: 5 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0.25, dueDay: 5 }, false],
    [{ rentCents: Number.NaN, condoCents: 0, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: Number.POSITIVE_INFINITY, condoCents: 0, otherFeesCents: 0, dueDay: 5 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0, dueDay: 1 }, true],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0, dueDay: 31 }, true],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0, dueDay: 0 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0, dueDay: 32 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0, dueDay: 5.5 }, false],
  ])("%j → %j", (rent, expected) => {
    expect(isValidRentInput(rent)).toBe(expected);
  });
});

describe("buildLeaseRent", () => {
  test("appends totalRentCents as the sum of the three legs and keeps the legs verbatim", () => {
    expect(
      buildLeaseRent({ rentCents: 250_000, condoCents: 45_000, otherFeesCents: 12_000, dueDay: 5 }),
    ).toEqual({
      rentCents: 250_000,
      condoCents: 45_000,
      otherFeesCents: 12_000,
      totalRentCents: 307_000,
      dueDay: 5,
    });
    expect(buildLeaseRent({ rentCents: 1, condoCents: 0, otherFeesCents: 0, dueDay: 5 })).toEqual({
      rentCents: 1,
      condoCents: 0,
      otherFeesCents: 0,
      totalRentCents: 1,
      dueDay: 5,
    });
  });
});

describe("dueDateFor", () => {
  test.each([
    ["2026-10", 5, "2026-10-05"],
    ["2026-10", 31, "2026-10-31"],
    ["2026-04", 31, "2026-04-30"],
    ["2026-02", 30, "2026-02-28"],
    ["2028-02", 30, "2028-02-29"],
    ["2026-12", 1, "2026-12-01"],
    ["2026-13", 5, null],
    ["2026-00", 5, null],
    ["2026-1", 5, null],
    ["2026-10-05", 5, null],
    ["2026-10", 0, null],
    ["2026-10", 32, null],
  ])("%s, day %i → %s", (referenceMonth, dueDay, expected) => {
    expect(dueDateFor({ referenceMonth, dueDay })).toBe(expected);
  });
});

describe("latestDueDateOnOrBefore", () => {
  test.each([
    ["2026-10-26", 5, "2026-10-05"],
    ["2026-10-05", 5, "2026-10-05"],
    ["2026-10-04", 5, "2026-09-05"],
    ["2026-03-15", 31, "2026-02-28"],
    ["2026-01-03", 10, "2025-12-10"],
    ["2026-10-26", 0, null],
  ])("%s, day %i → %s", (isoDate, dueDay, expected) => {
    expect(latestDueDateOnOrBefore({ isoDate, dueDay })).toBe(expected);
  });
});
