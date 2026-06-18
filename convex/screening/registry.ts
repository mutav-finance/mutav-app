import { getScoreProvider } from "../lib/env";
import type { ScreeningProvider } from "./domain";
import { mockProvider } from "./providers/mock";
import { cpfCnpjProvider } from "./providers/cpfcnpj";
import { bigDataCorpProvider } from "./providers/bigdatacorp";

const CREDIT_PROVIDERS: Record<string, ScreeningProvider> = {
  mock: mockProvider,
  cpfcnpj: cpfCnpjProvider,
  bigdatacorp: bigDataCorpProvider,
};

/** Providers to fan out for a credit_score pull on `document`. Phase 1 returns
 * exactly one (the primary); the array shape lets Phase 2 add hedge providers
 * without changing callers. */
export function resolveCreditProviders({ document }: { document: string }): ScreeningProvider[] {
  const digits = document.replace(/\D/g, "");
  // CNPJ (14 digits): no real credit bureau data in Phase 1 — always mock.
  if (digits.length === 14) return [mockProvider];

  const name = getScoreProvider();
  const primary = CREDIT_PROVIDERS[name];
  if (!primary) {
    throw new Error(
      `SCORE_PROVIDER="${name}" is not a known screening provider (expected: ${Object.keys(CREDIT_PROVIDERS).join(", ")}).`,
    );
  }
  return [primary];
}
