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
  RESIDENCIAL: "residencial",
  COMERCIAL: "comercial",
} as const satisfies Record<Uppercase<PropertyKind>, PropertyKind>;

export const propertyKindValidator = v.union(
  v.literal(PROPERTY_KIND.RESIDENCIAL),
  v.literal(PROPERTY_KIND.COMERCIAL),
);

/**
 * The party responsible for the guarantee's recurring fees. A category, not a
 * display label; UI components translate to user-facing copy via i18n.
 */
export const PAYER = {
  INQUILINO: "inquilino",
} as const satisfies Record<Uppercase<Payer>, Payer>;

export const payerValidator = v.literal(PAYER.INQUILINO);

export const DEFAULT_PAYER: Payer = PAYER.INQUILINO;

export const leasePropertyValidator = v.object({
  cep: v.string(),
  streetAndNumber: v.string(),
  neighborhood: v.string(),
  cityUF: v.string(),
  complement: v.string(),
});

/** Rent bundle as the agency submits it; `totalRentCents` is derived server-side. */
export const leaseRentInputValidator = v.object({
  rentCents: v.number(),
  condoCents: v.number(),
  otherFeesCents: v.number(),
});

export const leaseRentValidator = v.object({
  rentCents: v.number(),
  condoCents: v.number(),
  otherFeesCents: v.number(),
  totalRentCents: v.number(),
});

export type LeaseRentInput = {
  rentCents: number;
  condoCents: number;
  otherFeesCents: number;
};

export function isValidRentInput(rent: LeaseRentInput): boolean {
  return (
    Number.isInteger(rent.rentCents) &&
    rent.rentCents > 0 &&
    Number.isInteger(rent.condoCents) &&
    rent.condoCents >= 0 &&
    Number.isInteger(rent.otherFeesCents) &&
    rent.otherFeesCents >= 0
  );
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
