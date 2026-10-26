import { describe, expect, test } from "vitest";
import { matchesGuaranteeSearch, normalizeForSearch, reportableMonths } from "./report-late-rent";

const row = {
  tenantName: "João Pereira",
  streetAndNumber: "Rua Harmonia, 410",
  complement: "Apto 32",
  cityUF: "São Paulo/SP",
  guaranteePublicId: "1000042",
};

describe("normalizeForSearch", () => {
  test("drops accents and case", () => {
    expect(normalizeForSearch("  São JOÃO ")).toBe("sao joao");
  });
});

describe("matchesGuaranteeSearch", () => {
  test.each([
    ["", true],
    ["joao", true],
    ["harm 410", true],
    ["pereira sao paulo", true],
    ["apto 32", true],
    ["1000042", true],
    ["maria", false],
    ["harmonia 999", false],
  ])("%j → %s", (query, expected) => {
    expect(matchesGuaranteeSearch(row, query)).toBe(expected);
  });
});

describe("reportableMonths", () => {
  test("offers months whose rent is already overdue, newest first", () => {
    expect(
      reportableMonths({ today: "2026-10-26", dueDay: 5, activatedAt: "2026-07-15T00:00:00Z" }),
    ).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  test("leaves out the current month until its rent is overdue", () => {
    expect(
      reportableMonths({ today: "2026-10-05", dueDay: 5, activatedAt: "2026-08-01T00:00:00Z" }),
    ).toEqual(["2026-09", "2026-08"]);
  });

  test("caps the list at a year", () => {
    expect(reportableMonths({ today: "2026-10-26", dueDay: 5, activatedAt: null })).toHaveLength(
      12,
    );
  });

  test("clamps a day-31 lease to short months", () => {
    expect(
      reportableMonths({ today: "2026-03-10", dueDay: 31, activatedAt: "2026-01-01T00:00:00Z" }),
    ).toEqual(["2026-02", "2026-01"]);
  });
});
