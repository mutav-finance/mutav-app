// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../_generated/api";
import { seedAgencyWithMembership, setupAuthenticatedUser } from "../lib/testFixtures";
import schema from "../schema";
import { InvoiceStates, derivedStatus, isOverdue } from "./domain";

const TODAY = "2026-06-16";

describe("isOverdue / derivedStatus — pure helpers", () => {
  test("open invoice past its due date is overdue", () => {
    const invoice = { state: InvoiceStates.open(), dueDate: "2026-05-10" };
    expect(isOverdue(invoice, TODAY)).toBe(true);
    expect(derivedStatus(invoice, TODAY)).toBe("overdue");
  });

  test("open invoice with a future due date is plain open", () => {
    const invoice = { state: InvoiceStates.open(), dueDate: "2026-07-10" };
    expect(isOverdue(invoice, TODAY)).toBe(false);
    expect(derivedStatus(invoice, TODAY)).toBe("open");
  });

  test("a due date equal to today is not yet overdue", () => {
    const invoice = { state: InvoiceStates.open(), dueDate: TODAY };
    expect(isOverdue(invoice, TODAY)).toBe(false);
    expect(derivedStatus(invoice, TODAY)).toBe("open");
  });

  test("paid invoices are never overdue, even past their due date", () => {
    const invoice = { state: InvoiceStates.paid("2026-05-08"), dueDate: "2026-05-10" };
    expect(isOverdue(invoice, TODAY)).toBe(false);
    expect(derivedStatus(invoice, TODAY)).toBe("paid");
  });

  test("void invoices derive to void regardless of due date", () => {
    const invoice = { state: InvoiceStates.voided(), dueDate: "2026-05-10" };
    expect(isOverdue(invoice, TODAY)).toBe(false);
    expect(derivedStatus(invoice, TODAY)).toBe("void");
  });
});

describe("getOverdueCount — open + past-due counts as overdue", () => {
  test("counts only open invoices whose due date has passed", async () => {
    const t = convexTest(schema);
    const { asUser, userId } = await setupAuthenticatedUser(t);
    const agencyId = await seedAgencyWithMembership(t, userId);

    await t.run(async (ctx) => {
      const base = {
        agencyId,
        periodMonth: "2026-04",
        issuedAt: "2026-04-01",
        totalCents: 1000,
        method: null,
        lineItems: [],
      };
      // Overdue: open + past due date.
      await ctx.db.insert("invoices", {
        ...base,
        publicId: "INV-OVERDUE",
        dueDate: "2026-04-10",
        state: InvoiceStates.open(),
      });
      // Open but not yet due — not overdue.
      await ctx.db.insert("invoices", {
        ...base,
        publicId: "INV-FUTURE",
        dueDate: "2026-12-10",
        state: InvoiceStates.open(),
      });
      // Paid past the due date — not overdue.
      await ctx.db.insert("invoices", {
        ...base,
        publicId: "INV-PAID",
        dueDate: "2026-04-10",
        state: InvoiceStates.paid("2026-04-08"),
      });
    });

    const count = await asUser.query(api.invoices.useCases.getOverdueCount, { agencyId });
    expect(count).toBe(1);
  });
});
