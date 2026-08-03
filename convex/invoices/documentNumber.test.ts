// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import type { AgencyId } from "../agencies/domain";
import schema from "../schema";
import { allocateInvoiceDocumentNumber, formatInvoiceDocumentNumber } from "./lib/documentNumber";

const TAX_ID = "12345678000199";

async function seedAgency(
  t: ReturnType<typeof convexTest>,
  overrides: {
    cnpj?: string;
    cpf?: string;
    invoiceRef?: string;
    nextInvoiceSequence?: number;
  } = {},
): Promise<AgencyId> {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: "Imobiliária Teste",
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    }),
  );
}

async function allocate(t: ReturnType<typeof convexTest>, agencyId: AgencyId): Promise<string> {
  return t.run(async (ctx) => {
    const agency = await ctx.db.get(agencyId);
    if (agency === null) throw new Error("agency vanished");
    return allocateInvoiceDocumentNumber(ctx, agency);
  });
}

describe("invoice document number", () => {
  test("never derives from the agency tax id", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { cnpj: TAX_ID });

    const publicId = await allocate(t, agencyId);

    // The regression this whole change exists to prevent: the old scheme was
    // `INV-{period}-{last4 of CNPJ or CPF}`, which is personal data whenever
    // the agency is an empresário individual or MEI.
    expect(publicId).not.toContain(TAX_ID.slice(-4));
    expect(publicId).toMatch(/^INV-[0-9A-HJKMNP-TV-Z]{4}-\d{4,}$/);
  });

  test("a CPF-only agency leaks no tax-id digits either", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { cpf: "52998224725" });

    const publicId = await allocate(t, agencyId);

    expect(publicId).not.toContain("4725");
  });

  test("counts up per agency and is stable across allocations", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t);

    const first = await allocate(t, agencyId);
    const second = await allocate(t, agencyId);
    const third = await allocate(t, agencyId);

    const ref = first.split("-")[1];
    expect(first).toBe(`INV-${ref}-0001`);
    expect(second).toBe(`INV-${ref}-0002`);
    expect(third).toBe(`INV-${ref}-0003`);
  });

  test("two agencies sharing a tax-id tail no longer collide", async () => {
    const t = convexTest(schema);
    // Same last four digits — the exact input that produced one document
    // number for two agencies under the old scheme.
    const a = await seedAgency(t, { cnpj: "11111111000199" });
    const b = await seedAgency(t, { cnpj: "22222222000199" });

    expect(await allocate(t, a)).not.toBe(await allocate(t, b));
  });

  test("each agency's sequence is independent, so no agency learns the global count", async () => {
    const t = convexTest(schema);
    const a = await seedAgency(t);
    const b = await seedAgency(t);

    await allocate(t, a);
    await allocate(t, a);
    const bFirst = await allocate(t, b);

    // b issued one invoice and sees 0001 — it cannot infer that a issued two.
    expect(bFirst.endsWith("-0001")).toBe(true);
  });

  test("refuses to mint a number that is already taken", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { invoiceRef: "K7QX", nextInvoiceSequence: 1 });

    await t.run((ctx) =>
      ctx.db.insert("invoices", {
        agencyId,
        publicId: formatInvoiceDocumentNumber("K7QX", 1),
        periodMonth: "2026-07",
        issuedAt: "2026-07-01",
        dueDate: "2026-07-10",
        totalCents: 1000,
        state: { kind: "open" },
        lineItems: [],
      }),
    );

    // A duplicate must fail the write, not surface later as a `.unique()`
    // throw on read that breaks both invoices after the fact.
    await expect(allocate(t, agencyId)).rejects.toThrow(/already taken/);
  });

  test("mints a prefix no other agency holds", async () => {
    const t = convexTest(schema);
    const a = await seedAgency(t);
    const b = await seedAgency(t);

    await allocate(t, a);
    await allocate(t, b);

    const refs = await t.run(async (ctx) => {
      const rows = await ctx.db.query("agencies").collect();
      return rows.map((row) => row.invoiceRef);
    });

    expect(refs.every((ref) => ref !== undefined)).toBe(true);
    expect(new Set(refs).size).toBe(refs.length);
  });

  test("an agency that predates the scheme is healed on first allocation", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t);

    await allocate(t, agencyId);

    const agency = await t.run((ctx) => ctx.db.get(agencyId));
    expect(agency?.invoiceRef).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(agency?.nextInvoiceSequence).toBe(2);
  });

  test("pads to four digits and keeps growing past 9999", () => {
    expect(formatInvoiceDocumentNumber("K7QX", 1)).toBe("INV-K7QX-0001");
    expect(formatInvoiceDocumentNumber("K7QX", 9999)).toBe("INV-K7QX-9999");
    expect(formatInvoiceDocumentNumber("K7QX", 10000)).toBe("INV-K7QX-10000");
  });
});
