export type ContractAggregates = {
  countAtivos: number;
  countPendentes: number;
  sumInsuredCents: number;
  defaultRate: number;
  maxCapacityCents: number;
};

export type TreasurySnapshot = {
  address: string;
  xlmBalance: number;
  brlBalanceCents: number;
  explorerUrl: string;
};
