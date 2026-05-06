import type { Contract } from "./types";

const fictionalContracts: Record<string, Contract> = {
  "1000001": {
    id: "1000001",
    status: "ativo",
    nextRenewalDate: "2027-08-15",
    availableGuaranteeBRL: 90_000,
    rental: {
      propertyKind: "residencial",
      rentBRL: 3_200,
      condoBRL: 450,
      otherFeesBRL: 0,
      totalRentBRL: 3_650,
      feeBRL: 5_120,
      oneTimeActivationFeeBRL: 200,
      setupInstallments: 1,
      exitCostMultiplier: "6x",
      rentMultiplier: "40x",
      payer: "Recorrência via Imobiliária",
      pviMigrationSchedule: null,
    },
    property: {
      cep: "01310-100",
      streetAndNumber: "Av. Paulista, 1500",
      neighborhood: "Bela Vista",
      cityUF: "São Paulo/SP",
    },
    optional: {
      complement: "Apto 204",
      tag: "",
      description: "",
    },
    documents: [
      { key: "rentalContract", status: "pendente" },
      { key: "inspection", status: "pendente" },
      { key: "policy", status: "pendente" },
    ],
    history: [
      {
        at: "2026-04-22T17:03:00-03:00",
        username: "usuario.exemplo",
        message:
          "Atualizado status do contrato: 1000001. | Para: Aprovado. | Por usuário: usuario.exemplo",
      },
      {
        at: "2026-04-22T10:32:00-03:00",
        username: "usuario.exemplo",
        message:
          "Criada Solicitação #1000001 do tipo residencial, no produto Flex (Custo de saída: 6,00x; Cobertura: 40x; Comissão: 2,00%), com setup de R$ 200,00 e valor de aluguel R$ 3.200,00, valor do condomínio R$ 450,00, valor das taxas R$ 0,00, totalizando R$ 3.650,00. O imóvel está situado no endereço Av. Paulista, 1500, Bela Vista, São Paulo/SP.",
      },
    ],
    tenant: {
      approvalStatus: "aprovado",
      fullName: "Maria Silva Santos",
      cpf: "000.000.000-00",
      birthDate: "1990-05-12",
      email: "maria.exemplo@example.com",
      phone: "(11) 90000-0000",
      termApprovedAt: "2026-04-22T17:36:00-03:00",
    },
  },
};

export function getContractById(id: string): Contract | undefined {
  return fictionalContracts[id];
}
