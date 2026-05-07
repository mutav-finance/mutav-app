export type ContractStatus = "ativo" | "encerrado" | "pendente" | "cancelado";

export type DocumentStatus = "pendente" | "enviado" | "aprovado";

export type PropertyKind = "residencial" | "comercial";

export type ContractRentalData = {
  propertyKind: PropertyKind;
  rentBRL: number;
  condoBRL: number;
  otherFeesBRL: number;
  totalRentBRL: number;
  feeBRL: number;
  oneTimeActivationFeeBRL: number;
  setupInstallments: number;
  exitCostMultiplier: string;
  rentMultiplier: string;
  payer: string;
  pviMigrationSchedule: string | null;
};

export type ContractProperty = {
  cep: string;
  streetAndNumber: string;
  neighborhood: string;
  cityUF: string;
};

export type ContractOptional = {
  complement: string;
  tag: string;
  description: string;
};

export type ContractDocumentKey = "rentalContract" | "inspection" | "policy";

export type ContractDocument = {
  key: ContractDocumentKey;
  status: DocumentStatus;
};

export type ContractHistoryEntry = {
  at: string;
  username: string;
  message: string;
};

export type TenantApprovalStatus = "aprovado" | "pendente" | "reprovado";

export type ContractTenant = {
  approvalStatus: TenantApprovalStatus;
  fullName: string;
  cpf: string;
  birthDate: string;
  email: string;
  phone: string;
  termApprovedAt: string | null;
};

export type Contract = {
  id: string;
  status: ContractStatus;
  nextRenewalDate: string;
  availableGuaranteeBRL: number;
  rental: ContractRentalData;
  property: ContractProperty;
  optional: ContractOptional;
  documents: ContractDocument[];
  history: ContractHistoryEntry[];
  tenant: ContractTenant;
};
