import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { AUDIT_ACTION } from "../audit/domain";
import { appendAuditEntry } from "../audit/useCases";
import { SettlementMethods } from "../payments/domain";
import { recordSettlement } from "../payments/settlement";
import { INVOICE_LINE_ITEM_KIND, InvoiceMethods, InvoiceStates, isChargeable } from "./domain";
import { generateInvoiceMuxedId } from "./lib/muxedId";

/**
 * Generate one `invoices` record per agency for the given billing period.
 *
 * Rules:
 * - Only `ativo` contracts contribute line items.
 * - Every active contract generates a `recurring` line item (feeCents).
 * - Contracts whose `_creationTime` falls within the period also get an
 *   `activation` line item (oneTimeActivationFeeCents).
 * - Idempotent: skips agencies that already have a record for the period.
 * - `state` starts as `open`; `method` is `null` until the agency chooses one.
 * - `dueDate` is always the 10th of the billing month.
 *
 * Call manually:
 *   bunx convex run invoices/mutations:generateMonthlyInvoices '{"periodMonth":"2026-05"}'
 */
export const generateMonthlyInvoices = internalMutation({
  args: { periodMonth: v.string() },
  handler: async (ctx, { periodMonth }) => {
    // Period boundaries (UTC ms) — used to detect newly activated contracts.
    const [yearStr, monthStr] = periodMonth.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const periodStart = Date.UTC(year, month - 1, 1);
    const periodEnd = Date.UTC(year, month, 1); // exclusive

    const dueDate = `${periodMonth}-10`;
    const issuedAt = new Date().toISOString().split("T")[0]!;

    const agencies = await ctx.db.query("agencies").collect();

    type Result =
      | { agencyId: string; skipped: true }
      | { agencyId: string; invoiceId: string; totalCents: number; lineItemCount: number };

    const results: Result[] = [];

    for (const agency of agencies) {
      // ── Idempotency check ──────────────────────────────────────────────────
      const existing = await ctx.db
        .query("invoices")
        .withIndex("by_agency_period", (q) =>
          q.eq("agencyId", agency._id).eq("periodMonth", periodMonth),
        )
        .unique();

      if (existing !== null) {
        results.push({ agencyId: agency._id, skipped: true });
        continue;
      }

      // ── Collect active contracts ───────────────────────────────────────────
      const activeContracts = await ctx.db
        .query("contracts")
        .withIndex("by_agency_status", (q) => q.eq("agencyId", agency._id).eq("status", "ativo"))
        .collect();

      const lineItems: Array<{
        contractId: (typeof activeContracts)[number]["_id"];
        contractPublicId: string;
        kind: "recurring" | "activation";
        amountCents: number;
        description: string;
      }> = [];

      for (const contract of activeContracts) {
        // Recurring fee — every active contract.
        lineItems.push({
          contractId: contract._id,
          contractPublicId: contract.publicId,
          kind: INVOICE_LINE_ITEM_KIND.RECURRING,
          amountCents: contract.rental.feeCents,
          description: `Mensalidade — contrato ${contract.publicId}`,
        });

        // Activation fee — contracts first activated within this billing period.
        const activatedThisPeriod =
          contract._creationTime >= periodStart && contract._creationTime < periodEnd;

        if (activatedThisPeriod && contract.rental.oneTimeActivationFeeCents > 0) {
          lineItems.push({
            contractId: contract._id,
            contractPublicId: contract.publicId,
            kind: INVOICE_LINE_ITEM_KIND.ACTIVATION,
            amountCents: contract.rental.oneTimeActivationFeeCents,
            description: `Taxa de ativação — contrato ${contract.publicId}`,
          });
        }
      }

      const totalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);

      // Public ID: INV-{period}-{last 4 digits of CNPJ or CPF}
      const identifier = agency.cnpj ?? agency.cpf ?? "0000";
      const publicId = `INV-${periodMonth}-${identifier.slice(-4)}`;

      const invoiceId = await ctx.db.insert("invoices", {
        agencyId: agency._id,
        publicId,
        periodMonth,
        issuedAt,
        dueDate,
        totalCents,
        state: InvoiceStates.open(),
        method: null,
        muxedId: generateInvoiceMuxedId(),
        lineItems,
      });

      results.push({
        agencyId: agency._id,
        invoiceId,
        totalCents,
        lineItemCount: lineItems.length,
      });

      await appendAuditEntry(ctx, {
        actor: { kind: "system", source: "cron_monthly_billing" },
        action: AUDIT_ACTION.INVOICE_BATCH_GENERATED,
        resourceType: "invoices",
        resourceId: publicId,
        payload: {
          invoiceId,
          agencyId: agency._id,
          periodMonth,
          totalCents,
          lineItemCount: lineItems.length,
        },
      });
    }

    return results;
  },
});

/**
 * Choose a payment method for an existing open invoice. Exposed as
 * internal so the agency-facing action layer controls validation.
 */
export const setPaymentMethod = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    method: v.union(
      v.object({ kind: v.literal("boleto") }),
      v.object({ kind: v.literal("stellar"), destinationAddress: v.string() }),
      v.object({ kind: v.literal("pix"), pixKey: v.string() }),
    ),
  },
  handler: async (ctx, { invoiceId, method }) => {
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

    if (!isChargeable(invoice.state)) {
      throw new Error(`Cannot change method on an invoice in state "${invoice.state.kind}"`);
    }

    let newMethod: NonNullable<(typeof invoice)["method"]>;

    switch (method.kind) {
      case "boleto":
        newMethod = InvoiceMethods.boleto(null);
        break;
      case "stellar":
        newMethod = InvoiceMethods.stellar(method.destinationAddress);
        break;
      case "pix":
        newMethod = InvoiceMethods.pix(method.pixKey);
        break;
    }

    await ctx.db.patch(invoiceId, { method: newMethod });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "checkout_action" },
      action: AUDIT_ACTION.INVOICE_METHOD_SET,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: {
        invoiceId,
        agencyId: invoice.agencyId,
        methodKind: newMethod.kind,
      },
    });

    return { invoiceId, method: newMethod };
  },
});

/**
 * Idempotent mark-as-paid. Called by the Horizon reconciler when an
 * incoming Stellar payment matches an open invoice's muxed-id.
 *
 * No-ops if the invoice is already paid with the same txHash (re-runs
 * after restart are safe). Records the muxed `M…` destination + tx hash
 * on `method` and moves state to `paid` with the observed timestamp.
 */
export const markPaidByTx = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    txHash: v.string(),
    paidAt: v.string(),
    muxedAddress: v.string(),
  },
  handler: async (ctx, { invoiceId, txHash, paidAt, muxedAddress }) => {
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return { invoiceId, status: "not_found" as const };

    if (invoice.state.kind === "paid") {
      const existingTx = invoice.method?.kind === "stellar" ? invoice.method.txHash : null;
      if (existingTx === txHash) return { invoiceId, status: "already_paid" as const };
      return { invoiceId, status: "duplicate_inbound" as const };
    }

    await ctx.db.patch(invoiceId, {
      state: InvoiceStates.paid(paidAt),
      method: InvoiceMethods.stellar(muxedAddress, txHash),
    });

    await recordSettlement(ctx, {
      agencyId: invoice.agencyId,
      invoiceId,
      status: "succeeded",
      amountCents: invoice.totalCents,
      paidAt,
      externalRef: txHash,
      method: SettlementMethods.stellar(muxedAddress, txHash),
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "stellar_indexer" },
      action: AUDIT_ACTION.INVOICE_PAID,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: {
        invoiceId,
        agencyId: invoice.agencyId,
        method: "stellar",
        txHash,
        paidAt,
      },
    });

    return { invoiceId, status: "paid" as const };
  },
});

/**
 * Idempotent mark-as-paid for anchor-mediated on-ramps (e.g. testanchor /
 * Etherfuse Pix). Called from `pollPixOnramp` when the underlying anchor
 * order reaches `completed`.
 *
 * No-ops if the invoice is already paid via the same anchor txId. Records
 * the anchor's reported PIX key + anchor transaction ID on `method` and
 * moves state to `paid` with the observed timestamp.
 */
export const markPaidByAnchor = internalMutation({
  args: {
    invoiceId: v.id("invoices"),
    anchorTxId: v.string(),
    pixKey: v.string(),
    paidAt: v.string(),
  },
  handler: async (ctx, { invoiceId, anchorTxId, pixKey, paidAt }) => {
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) return { invoiceId, status: "not_found" as const };

    if (invoice.state.kind === "paid") {
      const existingTxId = invoice.method?.kind === "pix" ? invoice.method.txId : null;
      if (existingTxId === anchorTxId) return { invoiceId, status: "already_paid" as const };
      return { invoiceId, status: "duplicate_inbound" as const };
    }

    await ctx.db.patch(invoiceId, {
      state: InvoiceStates.paid(paidAt),
      method: InvoiceMethods.pix(pixKey, anchorTxId),
    });

    await recordSettlement(ctx, {
      agencyId: invoice.agencyId,
      invoiceId,
      status: "succeeded",
      amountCents: invoice.totalCents,
      paidAt,
      externalRef: anchorTxId,
      method: SettlementMethods.pix(pixKey, anchorTxId),
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "anchor_webhook" },
      action: AUDIT_ACTION.INVOICE_PAID,
      resourceType: "invoices",
      resourceId: invoice.publicId,
      payload: {
        invoiceId,
        agencyId: invoice.agencyId,
        method: "pix",
        anchorTxId,
        paidAt,
      },
    });

    return { invoiceId, status: "paid" as const };
  },
});

/**
 * Dev-only: flip an invoice back to `open` and clear `method`. Used to
 * rerun the demo flow against an already-paid invoice. The Horizon cursor
 * is not rewound, so the original tx is NOT re-discovered — only NEW
 * incoming payments to the muxed address re-mark this invoice paid.
 *
 *   bunx convex run invoices/mutations:resetInvoiceToOpen '{"publicId":"INV-TEST-001"}'
 */
export const resetInvoiceToOpen = internalMutation({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
      .unique();
    if (!invoice) throw new Error(`Invoice ${publicId} not found`);
    const previousState = invoice.state.kind;
    await ctx.db.patch(invoice._id, {
      state: InvoiceStates.open(),
      method: null,
    });

    await appendAuditEntry(ctx, {
      actor: { kind: "system", source: "dev_reset" },
      action: AUDIT_ACTION.INVOICE_RESET,
      resourceType: "invoices",
      resourceId: publicId,
      payload: {
        invoiceId: invoice._id,
        agencyId: invoice.agencyId,
        previousState,
      },
    });

    return { publicId, previousState };
  },
});

/**
 * Persist the latest Horizon paging token for a treasury account, so the
 * next polling tick resumes after the last processed record.
 */
export const setStellarIndexCursor = internalMutation({
  args: { sourceAccount: v.string(), cursor: v.string() },
  handler: async (ctx, { sourceAccount, cursor }) => {
    const lastRunAt = new Date().toISOString();
    const existing = await ctx.db
      .query("stellarIndexState")
      .withIndex("by_sourceAccount", (q) => q.eq("sourceAccount", sourceAccount))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { cursor, lastRunAt });
      return existing._id;
    }
    return ctx.db.insert("stellarIndexState", { sourceAccount, cursor, lastRunAt });
  },
});
