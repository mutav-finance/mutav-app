import { describe, expect, it } from "vitest";
import { formatBRLCents, formatBRLRate, formatDateTimeBR } from "./brazil";

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
});
