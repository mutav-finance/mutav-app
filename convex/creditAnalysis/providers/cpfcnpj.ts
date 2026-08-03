import { getCpfCnpjToken } from "../../lib/env";
import {
  CAPABILITY,
  DEFAULT_CREDIT_SCALE,
  TAX_ID_TRANSMISSION,
  type ProviderRequest,
  type ProviderSignal,
  type CreditAnalysisProvider,
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

/**
 * Pacote 13 — CPF Risco. `GET https://api.cpfcnpj.com.br/{token}/13/{cpf}`.
 *
 * The subject's tax ID stays in the URL path because the vendor exposes no
 * body-bearing form: probing the published API with the vendor's own test
 * token, every POST variant (JSON body and form body, against the root, the
 * token path and the token+package path) answers `400 Incorrect parameters`,
 * and the only documented shape is the path GET. The residual risk — the tax
 * ID reaching intermediary access logs — is therefore accepted and recorded
 * against the vendor rather than silently carried, per exception E-15 of the
 * data-access policy.
 */
export const cpfCnpjProvider: CreditAnalysisProvider = {
  name: "cpfcnpj",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  taxIdTransmission: TAX_ID_TRANSMISSION.URL_PATH,
  acceptedRisk: { exceptionId: "E-15", vendor: "cpfcnpj.com.br" },
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
