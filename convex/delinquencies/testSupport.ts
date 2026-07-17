import type { convexTest } from "convex-test";
import { api } from "../_generated/api";
import type { AgencyId } from "../agencies/domain";
import { insertContractAggregates } from "../contracts/aggregateWrites";
import type { ContractStatus } from "../contracts/domain";
import type { MutavStaffRole } from "../mutavStaff/domain";
import { DELINQUENCY_STATUS, type DelinquencyStatus } from "./domain";

type T = ReturnType<typeof convexTest>;
export type Actor = ReturnType<T["withIdentity"]>;

export type ContractSeed = {
  agencyId: AgencyId;
  status: ContractStatus;
  availableGuaranteeCents: number;
  tenantFullName?: string;
};

export async function seedAndIndexContract(t: T, spec: ContractSeed, publicId: string) {
  return t.run(async (ctx) => {
    const id = await ctx.db.insert("contracts", {
      agencyId: spec.agencyId,
      publicId,
      status: spec.status,
      activatedAt: null,
      nextRenewalDate: "2026-12-31",
      availableGuaranteeCents: spec.availableGuaranteeCents,
      rental: {
        propertyKind: "residencial",
        rentCents: 100000,
        condoCents: 0,
        otherFeesCents: 0,
        totalRentCents: 100000,
        feeCents: 1500,
        oneTimeActivationFeeCents: 0,
        setupInstallments: 1,
        exitCostMultiplier: "5x",
        rentMultiplier: "30x",
        payer: "inquilino",
        pviMigrationSchedule: null,
      },
      property: {
        cep: "01000000",
        streetAndNumber: "Rua Teste, 1",
        neighborhood: "Centro",
        cityUF: "São Paulo/SP",
      },
      optional: { complement: "", tag: "", description: "" },
      documents: [
        { key: "rentalContract", status: "pendente" },
        { key: "inspection", status: "pendente" },
        { key: "policy", status: "pendente" },
      ],
      tenant: {
        approvalStatus: "pendente",
        fullName: spec.tenantFullName ?? "Test Tenant",
        cpf: "11144477735",
        birthDate: "1990-01-01",
        email: "tenant@test.br",
        phone: "11999999999",
        termApprovedAt: null,
      },
    });
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("seed lost");
    await insertContractAggregates(ctx, doc);
    return id;
  });
}

export const STAFF_ADMIN_SUBJECT = "auth0|staff-admin";

export async function seedStaffActor(t: T, subject: string, roles: MutavStaffRole[]) {
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      publicId: `pub-${subject.replace(/[^a-zA-Z0-9-]/g, "-")}`,
      subject,
      name: "Staff",
      email: `${subject.replace(/[^a-zA-Z0-9-]/g, "-")}@test.br`,
      createdAt: new Date().toISOString(),
    });
    for (const role of roles) {
      await ctx.db.insert("mutavStaff", { userId: id, role, createdAt: new Date().toISOString() });
    }
    return id;
  });
  return { asStaff: t.withIdentity({ subject }), userId };
}

export async function staffAdvance(asStaff: Actor, publicId: string, toStatus: DelinquencyStatus) {
  const result =
    toStatus === DELINQUENCY_STATUS.UNDER_REVIEW
      ? await asStaff.mutation(api.delinquencies.adminUseCases.startReview, { publicId })
      : toStatus === DELINQUENCY_STATUS.PROVISIONED
        ? await asStaff.mutation(api.delinquencies.adminUseCases.provision, { publicId })
        : toStatus === DELINQUENCY_STATUS.PAID
          ? await asStaff.mutation(api.delinquencies.adminUseCases.markPaid, { publicId })
          : null;
  if (result === null) throw new Error(`No staff advance maps to '${toStatus}'`);
  if (!result.success) throw new Error(`Staff advance to '${toStatus}' failed: ${result.message}`);
  return result;
}
