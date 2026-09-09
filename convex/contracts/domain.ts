// Temporary facade over the `@convex/contracts/domain` symbols the agency app
// still imports. It keeps the pre-refactor wire values (`residencial`,
// `comercial`, `inquilino`) the UI branches on until PR4 moves the app onto
// `leases` / `guarantees`. Deleted in PR4 — add nothing here.
import { v } from "convex/values";
import type { Payer, PropertyKind as LeasePropertyKind } from "../leases/domain";
import { GUARANTEE_PLAN, type GuaranteePlan } from "../guarantees/domain";

export { TENANT_ENTITY_TYPE } from "../guarantees/domain";
export type {
  ScoreTier,
  TenantEntityType,
  ActivityBucket,
  ActivityGranularity,
  UrgencyTier,
} from "../guarantees/domain";

export const CONTRACT_PLAN = GUARANTEE_PLAN;
export type ContractPlan = GuaranteePlan;

export const PROPERTY_KIND = {
  RESIDENCIAL: "residencial",
  COMERCIAL: "comercial",
} as const satisfies Record<string, string>;

export type PropertyKind = (typeof PROPERTY_KIND)[keyof typeof PROPERTY_KIND];

export const propertyKindValidator = v.union(
  v.literal(PROPERTY_KIND.RESIDENCIAL),
  v.literal(PROPERTY_KIND.COMERCIAL),
);

const LEASE_PROPERTY_KIND_BY_LEGACY = {
  residencial: "residential",
  comercial: "commercial",
} as const satisfies Record<PropertyKind, LeasePropertyKind>;

const LEGACY_PROPERTY_KIND_BY_LEASE = {
  residential: "residencial",
  commercial: "comercial",
} as const satisfies Record<LeasePropertyKind, PropertyKind>;

export function toLeasePropertyKind(kind: PropertyKind): LeasePropertyKind {
  return LEASE_PROPERTY_KIND_BY_LEGACY[kind];
}

export function toLegacyPropertyKind(kind: LeasePropertyKind): PropertyKind {
  return LEGACY_PROPERTY_KIND_BY_LEASE[kind];
}

const LEGACY_PAYER_BY_PAYER = {
  tenant: "inquilino",
} as const satisfies Record<Payer, string>;

export function toLegacyPayer(payer: Payer): string {
  return LEGACY_PAYER_BY_PAYER[payer];
}
