import { afterEach, describe, expect, test } from "vitest";
import { resolveCreditProviders } from "./registry";

afterEach(() => {
  delete process.env.SCORE_PROVIDER; // hook-ok: test fixture — direct env mutation is the only way to control getScoreProvider() in unit tests
});

describe("resolveCreditProviders", () => {
  test("CNPJ (14 digits) always resolves to mock", () => {
    process.env.SCORE_PROVIDER = "bigdatacorp"; // hook-ok: test fixture
    expect(resolveCreditProviders({ document: "12345678000190" }).map((p) => p.name)).toEqual([
      "mock",
    ]);
  });
  test("CPF with no env → mock default", () => {
    expect(resolveCreditProviders({ document: "12345678901" }).map((p) => p.name)).toEqual([
      "mock",
    ]);
  });
  test("CPF honors SCORE_PROVIDER", () => {
    process.env.SCORE_PROVIDER = "bigdatacorp"; // hook-ok: test fixture
    expect(resolveCreditProviders({ document: "12345678901" }).map((p) => p.name)).toEqual([
      "bigdatacorp",
    ]);
  });
  test("unknown provider throws (no silent mock fallback)", () => {
    process.env.SCORE_PROVIDER = "nope"; // hook-ok: test fixture
    expect(() => resolveCreditProviders({ document: "12345678901" })).toThrow(/nope/);
  });
});
