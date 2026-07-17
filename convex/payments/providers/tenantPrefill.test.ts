// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../../schema";
import { tenantToSep9Prefill } from "./tenantPrefill";

const VALID_CPF = "52998224725";
const VALID_CNPJ = "11444777000161";

function setup() {
  return convexTest(schema);
}

/**
 * Round-trip through a real inserted `tenants` row so `tenantToSep9Prefill`
 * receives an actual `Doc<"tenants">` (branded `_id`/`_creationTime`) without
 * fabricating one via a cast.
 */
describe("tenantToSep9Prefill", () => {
  test("pf: id_number is the CPF tax id; name splits into first/last", async () => {
    const t = setup();
    const prefill = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        entityType: "pf",
        taxId: VALID_CPF,
        fullName: "Maria Silva Santos",
        birthDate: "1990-05-12",
        email: "maria@example.com",
        phone: "11900000001",
      });
      const tenant = await ctx.db.get(id);
      if (!tenant) throw new Error("seed tenant missing");
      return tenantToSep9Prefill(tenant);
    });

    expect(prefill).toEqual({
      first_name: "Maria",
      last_name: "Silva Santos",
      email_address: "maria@example.com",
      id_number: VALID_CPF,
    });
  });

  test("pj with a contact CPF: id_number is the contact CPF, never the CNPJ", async () => {
    const t = setup();
    const prefill = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        entityType: "pj",
        taxId: VALID_CNPJ,
        fullName: "Tech Solutions Ltda",
        contactCpf: VALID_CPF,
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
      });
      const tenant = await ctx.db.get(id);
      if (!tenant) throw new Error("seed tenant missing");
      return tenantToSep9Prefill(tenant);
    });

    expect(prefill.id_number).toBe(VALID_CPF);
    expect(prefill.id_number).not.toBe(VALID_CNPJ);
  });

  test("pj without a contact CPF: id_number is omitted (a CNPJ is not a personal document)", async () => {
    const t = setup();
    const prefill = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        entityType: "pj",
        taxId: VALID_CNPJ,
        fullName: "Tech Solutions Ltda",
        email: "contato@techsolutions.example.com",
        phone: "11900000003",
      });
      const tenant = await ctx.db.get(id);
      if (!tenant) throw new Error("seed tenant missing");
      return tenantToSep9Prefill(tenant);
    });

    expect(prefill.id_number).toBeUndefined();
  });
});
