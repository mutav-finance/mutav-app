import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { Result } from "../lib/result";

export type Lease = Doc<"leases">;
export type LeaseId = Id<"leases">;
export type LeaseRent = Lease["rent"];
export type LeaseProperty = Lease["property"];
export type PropertyKind = Lease["propertyKind"];
export type Payer = Lease["payer"];

export const PROPERTY_KIND = {
  RESIDENTIAL: "residential",
  COMMERCIAL: "commercial",
} as const satisfies Record<Uppercase<PropertyKind>, PropertyKind>;

export const propertyKindValidator = v.union(
  v.literal(PROPERTY_KIND.RESIDENTIAL),
  v.literal(PROPERTY_KIND.COMMERCIAL),
);

/**
 * The party responsible for the guarantee's recurring fees. A category, not a
 * display label; UI components translate to user-facing copy via i18n.
 */
export const PAYER = {
  TENANT: "tenant",
} as const satisfies Record<Uppercase<Payer>, Payer>;

export const payerValidator = v.literal(PAYER.TENANT);

export const DEFAULT_PAYER: Payer = PAYER.TENANT;

export const leasePropertyValidator = v.object({
  cep: v.string(),
  streetAndNumber: v.string(),
  neighborhood: v.string(),
  cityUF: v.string(),
  complement: v.string(),
});

/**
 * The day of the month the contract says rent is due. Any calendar day is
 * accepted as written: a lease due "todo dia 31" falls due on the last day of
 * the shorter months (see `dueDateFor`) instead of being rewritten to fit.
 */
export const LEASE_DUE_DAY_MIN = 1;
export const LEASE_DUE_DAY_MAX = 31;

/** Rent bundle as the agency submits it; `totalRentCents` is derived server-side. */
export const leaseRentInputValidator = v.object({
  rentCents: v.number(),
  condoCents: v.number(),
  otherFeesCents: v.number(),
  dueDay: v.number(),
});

export const leaseRentValidator = v.object({
  rentCents: v.number(),
  condoCents: v.number(),
  otherFeesCents: v.number(),
  totalRentCents: v.number(),
  dueDay: v.number(),
});

export type LeaseRentInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
  dueDay: number;
};

export function isValidDueDay(dueDay: number): boolean {
  return Number.isInteger(dueDay) && dueDay >= LEASE_DUE_DAY_MIN && dueDay <= LEASE_DUE_DAY_MAX;
}

export function isValidRentInput(rent: LeaseRentInput): boolean {
  return (
    Number.isInteger(rent.rentCents) &&
    rent.rentCents > 0 &&
    Number.isInteger(rent.condoCents) &&
    rent.condoCents >= 0 &&
    Number.isInteger(rent.otherFeesCents) &&
    rent.otherFeesCents >= 0 &&
    isValidDueDay(rent.dueDay)
  );
}

const REFERENCE_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * The rent due date (`YYYY-MM-DD`) for one month of a lease. A due day past
 * the month's length lands on its last day, so "dia 31" is 30/04 and 28/02 or
 * 29/02. `null` when `referenceMonth` is not a `YYYY-MM` month or the due day
 * is out of range.
 */
export function dueDateFor({
  referenceMonth,
  dueDay,
}: {
  referenceMonth: string;
  dueDay: number;
}): string | null {
  const match = REFERENCE_MONTH_PATTERN.exec(referenceMonth);
  if (!match || !isValidDueDay(dueDay)) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return `${referenceMonth}-${String(day).padStart(2, "0")}`;
}

export function buildLeaseRent(rent: LeaseRentInput): LeaseRent {
  return {
    ...rent,
    totalRentCents: rent.rentCents + rent.condoCents + rent.otherFeesCents,
  };
}

/**
 * The state abbreviation from a `"Cidade/UF"` (or `"Cidade / UF"`) string, as
 * the wizard captures it. `null` when no two-letter UF follows the slash, so
 * region-restricted products simply do not match rather than matching a
 * garbage token.
 */
export function ufFromCityUF(cityUF: string): string | null {
  const slash = cityUF.lastIndexOf("/");
  if (slash < 0) return null;
  const uf = cityUF
    .slice(slash + 1)
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(uf) ? uf : null;
}

export const LEASE_ERROR_CODE = {
  LEASE_HAS_OPEN_GUARANTEE: "LEASE_HAS_OPEN_GUARANTEE",
} as const satisfies Record<string, string>;

export type LeaseErrorCode = (typeof LEASE_ERROR_CODE)[keyof typeof LEASE_ERROR_CODE];

type LeaseAcceptsGuaranteeSuccess = { leaseId: LeaseId };
type LeaseAcceptsGuaranteeError = { code: typeof LEASE_ERROR_CODE.LEASE_HAS_OPEN_GUARANTEE };

/**
 * One-open-guarantee rule: a lease carries many guarantees over time but at
 * most one that is not `closed`. Pure check over the pointer the mutations
 * maintain; the caller reads the lease and patches the pointer in the same
 * transaction so OCC on the lease row serializes racing creates.
 */
export function assertLeaseAcceptsGuarantee(
  lease: Pick<Lease, "_id" | "openGuaranteeId">,
): Result<LeaseAcceptsGuaranteeSuccess, LeaseAcceptsGuaranteeError> {
  if (lease.openGuaranteeId !== null) {
    return {
      success: false,
      error: { code: LEASE_ERROR_CODE.LEASE_HAS_OPEN_GUARANTEE },
      message: `Lease ${lease._id} already has an open guarantee (${lease.openGuaranteeId}).`,
    };
  }
  return {
    success: true,
    data: { leaseId: lease._id },
    message: "Lease accepts a new guarantee.",
  };
}
