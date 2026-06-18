import {
  CAPABILITY,
  DEFAULT_CREDIT_SCALE,
  type ProviderRequest,
  type ProviderSignal,
  type ScreeningProvider,
} from "../domain";

/** Deterministic dev score in [300, 900] from the last 4 document digits. */
export function mockScoreFor(document: string): number {
  const digits = document.replace(/\D/g, "");
  if (!digits) return 300;
  return (parseInt(digits.slice(-4), 10) % 601) + 300;
}

export const mockProvider: ScreeningProvider = {
  name: "mock",
  capabilities: [CAPABILITY.CREDIT_SCORE],
  async query(req: ProviderRequest): Promise<ProviderSignal> {
    return {
      status: "ok",
      provider: "mock",
      capability: CAPABILITY.CREDIT_SCORE,
      normalized: { score: mockScoreFor(req.document), scale: DEFAULT_CREDIT_SCALE },
    };
  },
};
