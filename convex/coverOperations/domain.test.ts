import { describe, expect, test } from "vitest";
import { coveragePeriodOf, isExecuted } from "./domain";

describe("coveragePeriodOf", () => {
  test.each([
    ["2026-06-05", "2026-06"],
    ["2026-01-01", "2026-01"],
    ["2026-12-31", "2026-12"],
    ["2026-03-10T00:00:00.000Z", "2026-03"],
  ])("%s → %s", (rentDueDate, expected) => {
    expect(coveragePeriodOf(rentDueDate)).toBe(expected);
  });

  test("the first of the month stays in its own month (no timezone slide)", () => {
    expect(coveragePeriodOf("2026-07-01")).toBe("2026-07");
  });

  test.each(["", "05/06/2026", "2026-6-5", "2026-13-01", "2026-00-10", "not-a-date"])(
    "%j → null",
    (rentDueDate) => {
      expect(coveragePeriodOf(rentDueDate)).toBeNull();
    },
  );
});

describe("isExecuted", () => {
  test("executed → true, recorded → false", () => {
    expect(isExecuted("executed")).toBe(true);
    expect(isExecuted("recorded")).toBe(false);
  });
});
