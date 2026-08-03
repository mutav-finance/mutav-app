import { getBigDataCorpDataset, getBigDataCorpLogin, getBigDataCorpPassword } from "../../lib/env";
import {
  CAPABILITY,
  DEFAULT_CREDIT_SCALE,
  TAX_ID_TRANSMISSION,
  type ProviderRequest,
  type ProviderSignal,
  type CreditAnalysisProvider,
} from "../domain";

const AUTH_URL = "https://plataforma.bigdatacorp.com.br/tokens/generate";
const MARKETPLACE_URL = "https://plataforma.bigdatacorp.com.br/marketplace";

/** BigDataCorp dataset for the credit_score capability (env-overridable;
 * defaults to BoaVista One Score). Phase 2 keys this by capability when
 * registration / sanctions datasets are added. */
function creditDataset(): string {
  return getBigDataCorpDataset();
}

type BigDataCorpToken = { AccessToken: string; TokenId: string };

async function mintToken(): Promise<BigDataCorpToken> {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Login: getBigDataCorpLogin(), Password: getBigDataCorpPassword() }),
  });
  if (!res.ok) throw new Error(`auth ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>; // hook-ok: external API response
  const token = (data["AccessToken"] ?? data["accessToken"]) as string | undefined; // hook-ok: external API response
  const tokenId = (data["TokenId"] ?? data["tokenId"]) as string | undefined; // hook-ok: external API response
  if (!token || !tokenId) throw new Error("unexpected auth response shape");
  return { AccessToken: token, TokenId: tokenId };
}

/** Pulls the numeric score out of a BigDataCorp marketplace response. Tries the
 * known field aliases. Pure + exported for unit testing. */
export function extractBigDataCorpScore(json: unknown, dataset: string): number | null {
  if (typeof json !== "object" || json === null) return null;
  const results = (json as { Results?: unknown }).Results; // hook-ok: external API response
  if (!Array.isArray(results) || results.length === 0) return null;
  const first = results[0];
  if (typeof first !== "object" || first === null) return null;
  const block = (first as Record<string, unknown>)[dataset]; // hook-ok: external API response
  if (typeof block !== "object" || block === null) return null;
  const fields = block as Record<string, unknown>; // hook-ok: external API response
  const raw = fields["Score"] ?? fields["Pontos"] ?? fields["ScoreCredito"] ?? fields["Pontuacao"];
  return typeof raw === "number" ? raw : null;
}

export const bigDataCorpProvider: CreditAnalysisProvider = {
  name: "bigdatacorp",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  taxIdTransmission: TAX_ID_TRANSMISSION.REQUEST_BODY,
  async query(req: ProviderRequest): Promise<ProviderSignal> {
    try {
      const token = await mintToken();
      const dataset = creditDataset();
      const res = await fetch(MARKETPLACE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AccessToken: token.AccessToken,
          TokenId: token.TokenId,
        },
        body: JSON.stringify({ q: `doc${req.document}`, Datasets: dataset, type: "mix" }),
      });
      if (!res.ok) {
        return {
          status: "error",
          provider: "bigdatacorp",
          capability: req.capability,
          error: `query ${res.status}`,
        };
      }
      const data = (await res.json()) as { QueryId?: string }; // hook-ok: external API response
      const score = extractBigDataCorpScore(data, dataset);
      if (score === null) {
        return {
          status: "error",
          provider: "bigdatacorp",
          capability: req.capability,
          error: "score field not found",
        };
      }
      return {
        status: "ok",
        provider: "bigdatacorp",
        capability: CAPABILITY.CREDIT_SCORE,
        normalized: { score, scale: DEFAULT_CREDIT_SCALE },
        vendorRef: typeof data.QueryId === "string" ? data.QueryId : undefined,
      };
    } catch (e) {
      return {
        status: "error",
        provider: "bigdatacorp",
        capability: req.capability,
        error: String(e),
      };
    }
  },
};
