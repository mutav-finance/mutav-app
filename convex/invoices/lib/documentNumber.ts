import type { MutationCtx } from "../../_generated/server";
import type { Agency } from "../../agencies/domain";
import { generateAgencyInvoiceRef } from "../../lib/randomId";

const SEQUENCE_PAD = 4;
const REF_MINT_ATTEMPTS = 8;

/**
 * The only place an invoice document number is minted.
 *
 * Shape is `INV-{agencyRef}-{NNNN}`: a per-agency prefix minted once, plus that
 * agency's own counter. Both halves live on the `agencies` row, so a number is
 * a pure function of the agency's state at insert time and never of the
 * agency's tax ID, which is what the previous scheme used.
 *
 * Allocation happens in the same transaction as the insert. Convex mutations
 * are serializable, so the read-then-increment on `nextInvoiceSequence` cannot
 * interleave — the same OCC property `appendAuditEntry` relies on for the audit
 * chain head. There is no counter table and no lock.
 *
 * Gaps are acceptable and are never backfilled: a voided invoice keeps its
 * number. Nothing here requires contiguity — the tamper-evidence story is the
 * Stellar-anchored `mutavAuditLog`, which is a stronger guarantee than a
 * gapless integer and is already built.
 */
export async function allocateInvoiceDocumentNumber(
  ctx: MutationCtx,
  agency: Agency,
): Promise<string> {
  const invoiceRef = agency.invoiceRef ?? (await mintAgencyInvoiceRef(ctx));
  const sequence = agency.nextInvoiceSequence ?? 1;
  const publicId = formatInvoiceDocumentNumber(invoiceRef, sequence);

  await assertUniquePublicId(ctx, publicId);

  await ctx.db.patch(agency._id, {
    invoiceRef,
    nextInvoiceSequence: sequence + 1,
  });

  return publicId;
}

export function formatInvoiceDocumentNumber(invoiceRef: string, sequence: number): string {
  return `INV-${invoiceRef}-${String(sequence).padStart(SEQUENCE_PAD, "0")}`;
}

/**
 * Mint a prefix no other agency holds. ~20 bits over a handful of agencies
 * makes a clash unlikely rather than impossible, and a clash would silently
 * merge two agencies' numbering — so it is checked rather than assumed.
 */
async function mintAgencyInvoiceRef(ctx: MutationCtx): Promise<string> {
  for (let attempt = 0; attempt < REF_MINT_ATTEMPTS; attempt++) {
    const candidate = generateAgencyInvoiceRef();
    const taken = await ctx.db
      .query("agencies")
      .withIndex("by_invoiceRef", (q) => q.eq("invoiceRef", candidate))
      .first();
    if (taken === null) return candidate;
  }
  throw new Error(
    `Could not mint a free agency invoiceRef in ${REF_MINT_ATTEMPTS} attempts — the ref space is saturated or the by_invoiceRef index is wrong.`,
  );
}

/**
 * Both readers of `by_publicId` call `.unique()`, which throws on a second
 * match — so a duplicate does not degrade a read, it breaks it, for both
 * invoices, after the write has already committed. Failing here instead turns
 * that into a refused write with a legible cause.
 */
async function assertUniquePublicId(ctx: MutationCtx, publicId: string): Promise<void> {
  const clash = await ctx.db
    .query("invoices")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .first();

  if (clash !== null) {
    throw new Error(
      `Invoice document number ${publicId} is already taken by ${clash._id}. The agency's nextInvoiceSequence is behind its issued invoices.`,
    );
  }
}
