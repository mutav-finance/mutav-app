import {
  getBigDataCorpDataset,
  getBigDataCorpLogin,
  getBigDataCorpPassword,
  getCpfCnpjToken,
} from "../lib/env";

// ── Public contract ───────────────────────────────────────────────────────────

export type ScoreResult = {
  score: number;
  providerRef?: string;
};

/**
 * A score bureau provider. Implement this interface and call
 * `registerProvider` to make it available via `SCORE_PROVIDER=<name>`.
 */
export interface ScoreProvider {
  readonly name: string;
  fetchScore(cpf: string): Promise<ScoreResult>;
}

// ── Mock ──────────────────────────────────────────────────────────────────────

const mockProvider: ScoreProvider = {
  name: "mock",
  async fetchScore(cpf) {
    const digits = cpf.replace(/\D/g, "");
    const score = (parseInt(digits.slice(-4), 10) % 601) + 300;
    return { score };
  },
};

// ── CPF.CNPJ ─────────────────────────────────────────────────────────────────
//
// Pacote 13 — CPF Risco. R$ 0,23/consulta.
// Endpoint: GET https://api.cpfcnpj.com.br/{token}/13/{cpf}
// Response: { "CPF Risco": { "nivel": 1..3, "descricao": "Baixo|Médio|Alto",
//              "score": "501-700" } }
//
// Set via: bunx convex env set SCORE_PROVIDER cpfcnpj
//          bunx convex env set CPFCNPJ_TOKEN <token>
// Test token (fictional data only): 5ae973d7a997af13f0aaf2bf60e65803

function parseScoreRange(range: string): number {
  // "501-700" → midpoint 600; "1000" → 1000
  const parts = range.split("-").map((s) => parseInt(s.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return Math.round((parts[0] + parts[1]) / 2);
  }
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  throw new Error(`cpfcnpj: cannot parse score range "${range}"`);
}

const cpfCnpjProvider: ScoreProvider = {
  name: "cpfcnpj",
  async fetchScore(cpf) {
    const token = getCpfCnpjToken();
    const digits = cpf.replace(/\D/g, "");
    const res = await fetch(`https://api.cpfcnpj.com.br/${token}/13/${digits}`);
    if (!res.ok) throw new Error(`cpfcnpj: ${res.status} ${res.statusText}`);

    const data = (await res.json()) as Record<string, unknown>; // hook-ok: external API response
    const risco = data["CPF Risco"] as Record<string, unknown> | undefined; // hook-ok: external API response
    if (!risco)
      throw new Error(`cpfcnpj: "CPF Risco" missing in response: ${JSON.stringify(data)}`);

    const scoreRange = risco["score"];
    if (typeof scoreRange !== "string") {
      throw new Error(`cpfcnpj: unexpected score field: ${JSON.stringify(risco)}`);
    }

    return { score: parseScoreRange(scoreRange) };
  },
};

// ── BigDataCorp ───────────────────────────────────────────────────────────────

type BigDataCorpToken = { AccessToken: string; TokenId: string };

async function getBigDataCorpToken(): Promise<BigDataCorpToken> {
  const res = await fetch("https://plataforma.bigdatacorp.com.br/tokens/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ Login: getBigDataCorpLogin(), Password: getBigDataCorpPassword() }),
  });
  if (!res.ok) throw new Error(`BigDataCorp auth: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as Record<string, unknown>; // hook-ok: external API response
  const token = (data["AccessToken"] ?? data["accessToken"]) as string | undefined; // hook-ok: external API response
  const tokenId = (data["TokenId"] ?? data["tokenId"]) as string | undefined; // hook-ok: external API response
  if (!token || !tokenId) {
    throw new Error(`BigDataCorp auth: unexpected response shape: ${JSON.stringify(data)}`);
  }
  return { AccessToken: token, TokenId: tokenId };
}

const bigDataCorpProvider: ScoreProvider = {
  name: "bigdatacorp",
  async fetchScore(cpf) {
    const token = await getBigDataCorpToken();
    const dataset = getBigDataCorpDataset();

    const res = await fetch("https://plataforma.bigdatacorp.com.br/marketplace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        AccessToken: token.AccessToken,
        TokenId: token.TokenId,
      },
      body: JSON.stringify({ q: `doc${cpf}`, Datasets: dataset, type: "mix" }),
    });
    if (!res.ok) throw new Error(`BigDataCorp query: ${res.status} ${res.statusText}`);

    // hook-ok: external API response — BigDataCorp shape validated field-by-field below
    const data = (await res.json()) as {
      QueryId?: string;
      Results?: Array<Record<string, unknown>>;
    };

    const result = data.Results?.[0];
    if (!result) throw new Error("BigDataCorp: empty Results array");

    const datasetResult = result[dataset];
    if (typeof datasetResult !== "object" || datasetResult === null) {
      throw new Error(
        `BigDataCorp: dataset "${dataset}" missing from result: ${JSON.stringify(result)}`,
      );
    }

    const fields = datasetResult as Record<string, unknown>; // hook-ok: external API response
    const raw =
      fields["Score"] ?? fields["Pontos"] ?? fields["ScoreCredito"] ?? fields["Pontuacao"];
    if (typeof raw !== "number") {
      throw new Error(`BigDataCorp: score field not found in: ${JSON.stringify(fields)}`);
    }

    return {
      score: raw,
      providerRef: typeof data.QueryId === "string" ? data.QueryId : undefined,
    };
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, ScoreProvider> = {
  mock: mockProvider,
  cpfcnpj: cpfCnpjProvider,
  bigdatacorp: bigDataCorpProvider,
};

/**
 * Returns the provider registered under `name`.
 * Falls back to `mock` on unknown names so a misconfigured `SCORE_PROVIDER`
 * never causes a hard failure — the wizard stays functional.
 */
export function resolveProvider(name: string): ScoreProvider {
  return PROVIDERS[name] ?? PROVIDERS["mock"]!;
}

/**
 * Registers a new score provider. Call from a dedicated module and set
 * `SCORE_PROVIDER=<provider.name>` to activate.
 */
export function registerProvider(provider: ScoreProvider): void {
  PROVIDERS[provider.name] = provider;
}
