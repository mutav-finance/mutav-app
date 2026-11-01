import { describe, expect, it } from "vitest";
import {
  formatBRLCents,
  formatBRLRate,
  formatDateTimeBR,
  formatDateTimeBRT,
  formatMonthYear,
  formatWallClockDateTimeBR,
} from "./brazil";

// Intl emits a non-breaking space between "R$" and the figure.
const NBSP = " ";

describe("Brazil money and date formatters", () => {
  it("formats BRL cents in pt-BR regardless of the host locale", () => {
    expect(formatBRLCents(689_806_900)).toBe(`R$${NBSP}6.898.069,00`);
  });

  it("formats a BRL rate with pt-BR separators and up to four decimals", () => {
    expect(formatBRLRate(5.4321)).toBe("5,4321");
    expect(formatBRLRate(5.4)).toBe("5,40");
  });

  it("formats a timestamp day-first", () => {
    expect(formatDateTimeBR("2026-09-29T05:15:00")).toBe("29/09/2026, 05:15");
  });

  it("returns an unparseable timestamp untouched", () => {
    expect(formatDateTimeBR("not-a-date")).toBe("not-a-date");
  });

  it("pins a timestamp to São Paulo time regardless of the host timezone", () => {
    expect(formatDateTimeBRT("2026-09-29T16:08:00Z")).toBe("29/09/2026, 13:08");
    expect(formatDateTimeBRT(new Date(Date.UTC(2026, 0, 1, 2, 30)).toISOString())).toBe(
      "31/12/2025, 23:30",
    );
    expect(formatDateTimeBRT("not-a-date")).toBe("not-a-date");
  });

  it("formats a zoneless wall-clock timestamp without shifting it", () => {
    expect(formatWallClockDateTimeBR("2026-09-29 13:08:26")).toBe("29/09/2026, 13:08");
    expect(formatWallClockDateTimeBR("2026-09-28 13:00")).toBe("28/09/2026, 13:00");
    expect(formatWallClockDateTimeBR("garbage")).toBe("garbage");
  });

  it("formats a rent month in words, capitalizing only the first letter", () => {
    expect(formatMonthYear("2026-10-05", "pt-BR", { month: "short" })).toBe("out. de 26");
    expect(formatMonthYear("2026-10-05", "pt-BR", { month: "long" })).toBe("outubro de 2026");
    expect(formatMonthYear("2026-10", "pt-BR", { month: "long", capitalize: true })).toBe(
      "Outubro de 2026",
    );
    expect(formatMonthYear("2026-01-31", "en", { month: "long" })).toBe("January 2026");
    expect(formatMonthYear("garbage", "pt-BR", { month: "short" })).toBe("garbage");
  });
});
