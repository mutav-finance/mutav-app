import { describe, expect, it } from "vitest";
import { isWelcomeScreenAgencyType, parseChecklistItems } from "./use-welcome-screen";

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

describe("isWelcomeScreenAgencyType", () => {
  it.each(["autonomo", "empresa"])("accepts %s", (value) => {
    expect(isWelcomeScreenAgencyType(value)).toBe(true);
  });

  it.each(["", "Empresa", "pj"])("rejects %j", (value) => {
    expect(isWelcomeScreenAgencyType(value)).toBe(false);
  });
});
