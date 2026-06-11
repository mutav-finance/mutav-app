export type ContractAggregates = {
  countAtivos: number;
  countPendentes: number;
  sumInsuredCents: number;
  defaultRate: number | null;
  maxCapacityCents: number;
};

export type ReserveCoverage = { explorerUrl: string } & (
  | { available: true; storedValueCents: number; capturedAt: number; assetCount: number }
  | { available: false }
);
