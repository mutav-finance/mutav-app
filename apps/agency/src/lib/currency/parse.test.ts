import { describe, expect, test } from "vitest";
import { parseAmountToCents } from "./parse";

describe("parseAmountToCents", () => {
  test("empty string returns null", () => {
    expect(parseAmountToCents("")).toBeNull();
  });

  test("plain zero returns null (non-positive)", () => {
    expect(parseAmountToCents("0")).toBeNull();
  });

  test("formatted zero returns null (non-positive)", () => {
    expect(parseAmountToCents("0,00")).toBeNull();
  });

  test("full pt-BR currency string with thousands separator parses to cents", () => {
    expect(parseAmountToCents("R$ 1.234,56")).toBe(123456);
  });

  test("comma-decimal without R$ prefix parses to cents", () => {
    expect(parseAmountToCents("1234,56")).toBe(123456);
  });

  test("single-digit decimal is scaled to cents", () => {
    expect(parseAmountToCents("R$ 12,3")).toBe(1230);
  });

  test("no decimal component parses as whole reais", () => {
    expect(parseAmountToCents("R$ 12")).toBe(1200);
  });

  test("non-numeric input returns null", () => {
    expect(parseAmountToCents("abc")).toBeNull();
  });

  test("negative amount returns null (non-positive)", () => {
    expect(parseAmountToCents("-10,00")).toBeNull();
  });

  test("surrounding whitespace is trimmed", () => {
    expect(parseAmountToCents("  R$ 5,00  ")).toBe(500);
  });
});
