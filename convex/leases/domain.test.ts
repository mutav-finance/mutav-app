import { describe, expect, test } from "vitest";
import { buildLeaseRent, isValidRentInput, ufFromCityUF } from "./domain";

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
    [{ rentCents: 1, condoCents: 0, otherFeesCents: 0 }, true],
    [{ rentCents: 100_000, condoCents: 45_000, otherFeesCents: 12_000 }, true],
    [{ rentCents: 0, condoCents: 0, otherFeesCents: 0 }, false],
    [{ rentCents: -100, condoCents: 0, otherFeesCents: 0 }, false],
    [{ rentCents: 1000.5, condoCents: 0, otherFeesCents: 0 }, false],
    [{ rentCents: 100_000, condoCents: -1, otherFeesCents: 0 }, false],
    [{ rentCents: 100_000, condoCents: 10.5, otherFeesCents: 0 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: -1 }, false],
    [{ rentCents: 100_000, condoCents: 0, otherFeesCents: 0.25 }, false],
    [{ rentCents: Number.NaN, condoCents: 0, otherFeesCents: 0 }, false],
    [{ rentCents: Number.POSITIVE_INFINITY, condoCents: 0, otherFeesCents: 0 }, false],
  ])("%j → %j", (rent, expected) => {
    expect(isValidRentInput(rent)).toBe(expected);
  });
});

describe("buildLeaseRent", () => {
  test("appends totalRentCents as the sum of the three legs and keeps the legs verbatim", () => {
    expect(
      buildLeaseRent({ rentCents: 250_000, condoCents: 45_000, otherFeesCents: 12_000 }),
    ).toEqual({
      rentCents: 250_000,
      condoCents: 45_000,
      otherFeesCents: 12_000,
      totalRentCents: 307_000,
    });
    expect(buildLeaseRent({ rentCents: 1, condoCents: 0, otherFeesCents: 0 })).toEqual({
      rentCents: 1,
      condoCents: 0,
      otherFeesCents: 0,
      totalRentCents: 1,
    });
  });
});
