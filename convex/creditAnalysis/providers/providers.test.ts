import { describe, expect, test } from "vitest";
import { mockScoreFor } from "./mock";
import { parseScoreRange } from "./cpfcnpj";
import { extractBigDataCorpScore } from "./bigdatacorp";

describe("mockScoreFor", () => {
  test("deterministic within [300, 900]", () => {
    const s = mockScoreFor("12345678901");
    expect(s).toBe(mockScoreFor("12345678901"));
    expect(s).toBeGreaterThanOrEqual(300);
    expect(s).toBeLessThanOrEqual(900);
  });
});

describe("parseScoreRange", () => {
  test("range midpoint", () => expect(parseScoreRange("501-700")).toBe(600));
  test("single value", () => expect(parseScoreRange("1000")).toBe(1000));
  test("garbage → null", () => expect(parseScoreRange("abc")).toBeNull());
});

describe("extractBigDataCorpScore", () => {
  const dataset = "partner_boavista_one_score_person";
  test("reads Score from the dataset block", () => {
    const json = { Results: [{ [dataset]: { Score: 742 } }] };
    expect(extractBigDataCorpScore(json, dataset)).toBe(742);
  });
  test("accepts the Pontos alias", () => {
    const json = { Results: [{ [dataset]: { Pontos: 610 } }] };
    expect(extractBigDataCorpScore(json, dataset)).toBe(610);
  });
  test("accepts the ScoreCredito and Pontuacao aliases", () => {
    expect(
      extractBigDataCorpScore({ Results: [{ [dataset]: { ScoreCredito: 555 } }] }, dataset),
    ).toBe(555);
    expect(extractBigDataCorpScore({ Results: [{ [dataset]: { Pontuacao: 480 } }] }, dataset)).toBe(
      480,
    );
  });
  test("missing score → null", () => {
    expect(extractBigDataCorpScore({ Results: [{ [dataset]: {} }] }, dataset)).toBeNull();
    expect(extractBigDataCorpScore({ Results: [] }, dataset)).toBeNull();
  });
});
