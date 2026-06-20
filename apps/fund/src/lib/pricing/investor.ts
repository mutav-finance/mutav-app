export const INVESTOR_FEE_RATE = 0.003;

/** Frozen demo XLM/USD rate; v1.1 will read a price feed. */
export const XLM_PRICE_USD = 0.1234;

export type InvestorFeeBreakdown = {
  feeUsd: number;
  netUsd: number;
};

/**
 * Protocol fee applied to investor deposits and redemptions.
 * Operates on USD floats (not BRL cents) because the investor leg
 * settles in USD-denominated fund tokens.
 */
export function applyInvestorFee(amountUsd: number): InvestorFeeBreakdown {
  const feeUsd = amountUsd * INVESTOR_FEE_RATE;
  return {
    feeUsd,
    netUsd: amountUsd - feeUsd,
  };
}
