import { getCpfCnpjToken } from "../../lib/env";
import {
  CAPABILITY,
  DEFAULT_CREDIT_SCALE,
  type ProviderRequest,
  type ProviderSignal,
  type ScreeningProvider,
} from "../domain";

/** "501-700" → 600 (midpoint); "1000" → 1000; unparseable → null. */
export function parseScoreRange(range: string): number | null {
  const parts = range.split("-").map((s) => parseInt(s.trim(), 10));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return Math.floor((parts[0] + parts[1]) / 2);
  }
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  return null;
}

// Pacote 13 — CPF Risco. GET https://api.cpfcnpj.com.br/{token}/13/{cpf}
export const cpfCnpjProvider: ScreeningProvider = {
  name: "cpfcnpj",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  async query(req: ProviderRequest): Promise<ProviderSignal> {
    try {
      const token = getCpfCnpjToken();
      const digits = req.document.replace(/\D/g, "");
      const res = await fetch(`https://api.cpfcnpj.com.br/${token}/13/${digits}`);
      if (!res.ok) {
        return {
          status: "error",
          provider: "cpfcnpj",
          capability: req.capability,
          error: `query ${res.status}`,
        };
      }
      const data = (await res.json()) as Record<string, unknown>; // hook-ok: external API response
      const riscoRaw = data["CPF Risco"];
      const risco =
        typeof riscoRaw === "object" && riscoRaw !== null
          ? (riscoRaw as Record<string, unknown>) // hook-ok: external API response
          : undefined;
      const scoreRange = risco?.["score"];
      const score = typeof scoreRange === "string" ? parseScoreRange(scoreRange) : null;
      if (score === null) {
        return {
          status: "error",
          provider: "cpfcnpj",
          capability: req.capability,
          error: "score field missing/unparseable",
        };
      }
      return {
        status: "ok",
        provider: "cpfcnpj",
        capability: CAPABILITY.CREDIT_SCORE,
        normalized: { score, scale: DEFAULT_CREDIT_SCALE },
      };
    } catch (e) {
      return { status: "error", provider: "cpfcnpj", capability: req.capability, error: String(e) };
    }
  },
};
