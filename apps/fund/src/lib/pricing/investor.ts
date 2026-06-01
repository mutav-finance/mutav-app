export const INVESTOR_FEE_RATE = 0.003;

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
