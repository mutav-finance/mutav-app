export type RiskLevel = "low" | "medium" | "high";
export type FundId = "MTVL" | "MTVM" | "MTVH";

export function isFundId(value: string): value is FundId {
  return FUNDS.some((f) => f.id === value);
}

export const RISK_COLOR: Record<RiskLevel, string> = {
  low: "bg-success",
  medium: "bg-accent",
  high: "bg-error",
};

export type Fund = {
  id: FundId;
  name: string;
  description: string;
  apy: number;
  aumUsd: number;
  navPrice: number;
  contractsCovered: number;
  risk: RiskLevel;
};

export const FUNDS: Fund[] = [
  {
    id: "MTVL",
    name: "MUTAV Low",
    description: "Low-Risk Guarantee Fund",
    apy: 12.4,
    aumUsd: 8_400_000,
    navPrice: 1.0312,
    contractsCovered: 1240,
    risk: "low",
  },
  {
    id: "MTVM",
    name: "MUTAV Medium",
    description: "Balanced Guarantee Fund",
    apy: 18.7,
    aumUsd: 5_200_000,
    navPrice: 1.0847,
    contractsCovered: 680,
    risk: "medium",
  },
  {
    id: "MTVH",
    name: "MUTAV High",
    description: "High-Risk Guarantee Fund",
    apy: 31.2,
    aumUsd: 2_100_000,
    navPrice: 1.2134,
    contractsCovered: 290,
    risk: "high",
  },
];

export const PROTOCOL_STATS = {
  totalAumUsd: FUNDS.reduce((acc, f) => acc + f.aumUsd, 0),
  minApy: Math.min(...FUNDS.map((f) => f.apy)),
  maxApy: Math.max(...FUNDS.map((f) => f.apy)),
  totalContracts: FUNDS.reduce((acc, f) => acc + f.contractsCovered, 0),
};
