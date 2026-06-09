// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { internal } from "../_generated/api";

const VALID_CNPJ = "11222333000181";

// Migration tests run without schema validation so legacy `branch` fields
// (the very thing being migrated) can be seeded into the docs.
function setup() {
  return convexTest();
}

async function seedAgency(
  t: ReturnType<typeof setup>,
  bankingInfo: Record<string, unknown> | undefined,
  cnpj: string,
) {
  return t.run(async (ctx) => {
    return ctx.db.insert("agencies", {
      name: "Test Agency",
      cnpj,
      agencyType: "empresa",
      onboardingState: "in_progress",
      createdAt: new Date().toISOString(),
      ...(bankingInfo === undefined ? {} : { bankingInfo: bankingInfo as never }),
    });
  });
}

describe("backfillBankingAgencyField", () => {
  test("patches legacy branch → agency on a single agency", async () => {
    const t = setup();
    const id = await seedAgency(
      t,
      { bank: "Nubank", branch: "0001", account: "12345-6", accountType: "corrente" },
      VALID_CNPJ,
    );

    const result = await t.mutation(internal.agencies.migrations.backfillBankingAgencyField, {});
    expect(result).toEqual({
      patched: 1,
      alreadyMigrated: 0,
      noBankingInfo: 0,
      malformed: 0,
      total: 1,
    });

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.bankingInfo).toEqual({
      bank: "Nubank",
      agency: "0001",
      account: "12345-6",
      accountType: "corrente",
    });
  });

  test("leaves an already-migrated agency untouched", async () => {
    const t = setup();
    const id = await seedAgency(
      t,
      { bank: "Nubank", agency: "0001", account: "12345-6", accountType: "corrente" },
      VALID_CNPJ,
    );

    const result = await t.mutation(internal.agencies.migrations.backfillBankingAgencyField, {});
    expect(result).toEqual({
      patched: 0,
      alreadyMigrated: 1,
      noBankingInfo: 0,
      malformed: 0,
      total: 1,
    });

    const after = await t.run((ctx) => ctx.db.get(id));
    expect(after?.bankingInfo).toEqual({
      bank: "Nubank",
      agency: "0001",
      account: "12345-6",
      accountType: "corrente",
    });
  });

  test("counts an agency with no bankingInfo as noBankingInfo", async () => {
    const t = setup();
    await seedAgency(t, undefined, VALID_CNPJ);

    const result = await t.mutation(internal.agencies.migrations.backfillBankingAgencyField, {});
    expect(result).toEqual({
      patched: 0,
      alreadyMigrated: 0,
      noBankingInfo: 1,
      malformed: 0,
      total: 1,
    });
  });

  test("counts mixed batch correctly", async () => {
    const t = setup();
    // 3 legacy
    await seedAgency(
      t,
      { bank: "B1", branch: "001", account: "1", accountType: "corrente" },
      "11222333000181",
    );
    await seedAgency(
      t,
      { bank: "B2", branch: "002", account: "2", accountType: "corrente" },
      "11222333000262",
    );
    await seedAgency(
      t,
      { bank: "B3", branch: "003", account: "3", accountType: "poupanca" },
      "11222333000343",
    );
    // 2 already migrated
    await seedAgency(
      t,
      { bank: "B4", agency: "004", account: "4", accountType: "corrente" },
      "11222333000424",
    );
    await seedAgency(
      t,
      { bank: "B5", agency: "005", account: "5", accountType: "corrente" },
      "11222333000505",
    );
    // 1 no bankingInfo
    await seedAgency(t, undefined, "11222333000686");

    const result = await t.mutation(internal.agencies.migrations.backfillBankingAgencyField, {});
    expect(result).toEqual({
      patched: 3,
      alreadyMigrated: 2,
      noBankingInfo: 1,
      malformed: 0,
      total: 6,
    });
  });

  test("is idempotent — second run patches nothing", async () => {
    const t = setup();
    await seedAgency(
      t,
      { bank: "Nubank", branch: "0001", account: "12345-6", accountType: "corrente" },
      VALID_CNPJ,
    );

    const first = await t.mutation(internal.agencies.migrations.backfillBankingAgencyField, {});
    expect(first.patched).toBe(1);

    const second = await t.mutation(internal.agencies.migrations.backfillBankingAgencyField, {});
    expect(second).toEqual({
      patched: 0,
      alreadyMigrated: 1,
      noBankingInfo: 0,
      malformed: 0,
      total: 1,
    });
  });
});
