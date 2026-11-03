import { describe, expect, it } from "vitest";
import {
  currentCommissionMonth,
  filterCommissionRows,
  shiftPeriodMonth,
  summarizeCommission,
} from "./view-model";

const ROWS = [
  { guaranteeId: "GAR-001", tenantName: "Ana Souza", commissionCents: 15_000 },
  { guaranteeId: "GAR-002", tenantName: "Bruno Lima", commissionCents: 22_500 },
  { guaranteeId: "GAR-003", tenantName: "Carla Dias", commissionCents: 9_900 },
];

describe("commission view model", () => {
  it("keeps the month KPI unchanged when the search narrows the table", () => {
    const filtered = filterCommissionRows(ROWS, "bruno");
    expect(filtered.map((row) => row.guaranteeId)).toEqual(["GAR-002"]);
    expect(summarizeCommission(ROWS)).toEqual({
      totalCommissionCents: 47_400,
      guaranteeCount: 3,
    });
  });

  it("matches the search on guarantee ID or tenant name, case-insensitively", () => {
    expect(filterCommissionRows(ROWS, "gar-003").map((row) => row.tenantName)).toEqual([
      "Carla Dias",
    ]);
    expect(filterCommissionRows(ROWS, "  ").length).toBe(3);
    expect(filterCommissionRows(ROWS, "nobody")).toEqual([]);
  });

  it("summarizes an empty month as zero", () => {
    expect(summarizeCommission([])).toEqual({ totalCommissionCents: 0, guaranteeCount: 0 });
  });

  it("opens on the São Paulo month, not the UTC month, near midnight", () => {
    // 01:30 UTC on Nov 1 is still 22:30 on Oct 31 in São Paulo.
    expect(currentCommissionMonth(new Date("2026-11-01T01:30:00Z"))).toBe("2026-10");
    expect(currentCommissionMonth(new Date("2026-11-01T03:00:00Z"))).toBe("2026-11");
  });

  it("shifts a period across year boundaries", () => {
    expect(shiftPeriodMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriodMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftPeriodMonth("2026-06", -1)).toBe("2026-05");
  });
});
