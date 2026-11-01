import { describe, expect, it } from "vitest";
import { nextAgencyType, parseChecklistItems } from "./use-welcome-screen";

describe("parseChecklistItems", () => {
  it("keeps well-formed rows with and without a note", () => {
    expect(parseChecklistItems([{ label: "CPF" }, { label: "Bank", note: "for fees" }])).toEqual([
      { label: "CPF" },
      { label: "Bank", note: "for fees" },
    ]);
  });

  it("drops malformed rows", () => {
    expect(parseChecklistItems([{ label: 1 }, null, "CPF", { label: "CNPJ", note: 2 }])).toEqual(
      [],
    );
  });

  it("returns an empty list for a non-array value", () => {
    expect(parseChecklistItems("onboarding.welcome.autonomo.items")).toEqual([]);
  });
});

describe("nextAgencyType", () => {
  it.each([
    { current: null, key: "ArrowDown", expected: "autonomo" },
    { current: null, key: "ArrowUp", expected: "empresa" },
    { current: "autonomo", key: "ArrowRight", expected: "empresa" },
    { current: "empresa", key: "ArrowDown", expected: "autonomo" },
    { current: "autonomo", key: "ArrowLeft", expected: "empresa" },
    { current: "empresa", key: "ArrowUp", expected: "autonomo" },
  ] as const)("$key from $current moves to $expected", ({ current, key, expected }) => {
    expect(nextAgencyType({ current, key })).toBe(expected);
  });

  it("ignores keys that are not arrows", () => {
    expect(nextAgencyType({ current: "autonomo", key: "Tab" })).toBeNull();
  });
});
