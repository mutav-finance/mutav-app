import { afterEach, describe, expect, test, vi } from "vitest";
import { CAPABILITY, TAX_ID_TRANSMISSION, type CreditAnalysisProvider } from "../domain";
import { mockProvider, mockScoreFor } from "./mock";
import { cpfCnpjProvider, parseScoreRange } from "./cpfcnpj";
import { bigDataCorpProvider, extractBigDataCorpScore } from "./bigdatacorp";

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

describe("tax-ID transmission", () => {
  const ALL_PROVIDERS: readonly CreditAnalysisProvider[] = [
    mockProvider,
    bigDataCorpProvider,
    cpfCnpjProvider,
  ];
  const SUBJECT_CPF = "11144477735";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function stubFetchCapturingUrls(urls: string[]): void {
    vi.stubGlobal("fetch", (input: string) => {
      urls.push(input);
      return Promise.resolve(
        new Response(JSON.stringify({ AccessToken: "t", TokenId: "i", Results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  }

  test.each(ALL_PROVIDERS.filter((p) => p.taxIdTransmission !== TAX_ID_TRANSMISSION.URL_PATH))(
    "$name sends no tax ID in any request URL",
    async (provider) => {
      vi.stubEnv("BIGDATACORP_LOGIN", "login@test.br");
      vi.stubEnv("BIGDATACORP_PASSWORD", "password");
      const urls: string[] = [];
      stubFetchCapturingUrls(urls);

      await provider.query({
        subjectType: "tenant",
        document: SUBJECT_CPF,
        capability: CAPABILITY.CREDIT_SCORE,
      });

      for (const url of urls) {
        expect(url).not.toContain(SUBJECT_CPF);
      }
    },
  );

  test("bigdatacorp puts the tax ID in the POST body, not the URL", async () => {
    vi.stubEnv("BIGDATACORP_LOGIN", "login@test.br");
    vi.stubEnv("BIGDATACORP_PASSWORD", "password");
    const bodies: string[] = [];
    const urls: string[] = [];
    vi.stubGlobal("fetch", (input: string, init?: { body?: string }) => {
      urls.push(input);
      if (typeof init?.body === "string") bodies.push(init.body);
      return Promise.resolve(
        new Response(JSON.stringify({ AccessToken: "t", TokenId: "i", Results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    await bigDataCorpProvider.query({
      subjectType: "tenant",
      document: SUBJECT_CPF,
      capability: CAPABILITY.CREDIT_SCORE,
    });

    expect(urls.some((url) => url.includes(SUBJECT_CPF))).toBe(false);
    expect(bodies.some((body) => body.includes(SUBJECT_CPF))).toBe(true);
  });

  test("the only url_path provider is cpfcnpj, under a recorded accepted risk", () => {
    const urlPathProviders = ALL_PROVIDERS.filter(
      (p) => p.taxIdTransmission === TAX_ID_TRANSMISSION.URL_PATH,
    );
    expect(urlPathProviders.map((p) => p.name)).toEqual(["cpfcnpj"]);
    for (const provider of urlPathProviders) {
      if (provider.taxIdTransmission !== TAX_ID_TRANSMISSION.URL_PATH) continue;
      expect(provider.acceptedRisk.exceptionId).toBe("E-15");
      expect(provider.acceptedRisk.vendor).toBe("cpfcnpj.com.br");
    }
  });
});
