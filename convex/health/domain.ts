export type ContractAggregates = {
  countAtivos: number;
  countPendentes: number;
  sumInsuredCents: number;
  defaultRate: number;
  maxCapacityCents: number;
};

export type TimelineWeek = {
  weekStartISO: string;
  activeContracts: number;
  cancelledContracts: number;
  delinquentContracts: number;
};

export type HealthTimeline = TimelineWeek[];

export type TreasurySnapshot = {
  address: string;
  xlmBalance: number;
  brlBalanceCents: number;
  explorerUrl: string;
};
