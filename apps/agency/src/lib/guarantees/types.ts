import type { AgencyId } from "@convex/agencies/domain";
import type {
  DocumentKey,
  DocumentStatus,
  GuaranteeCapacity,
  GuaranteeClosure,
  GuaranteeState,
  GuaranteeTerms,
  GuaranteeUnderwriting,
  TenantApprovalStatus,
} from "@convex/guarantees/domain";
import type { LeaseProperty, LeaseRent, Payer, PropertyKind } from "@convex/leases/domain";

// Value-object types come from the backend domain modules rather than being
// restated here: a state the server adds or renames must break this
// compilation, not silently reach a branch that no longer exists.
export type {
  DocumentStatus,
  GuaranteeCapacity,
  GuaranteeClosure,
  GuaranteeState,
  GuaranteeTerms,
  GuaranteeUnderwriting,
  LeaseProperty,
  LeaseRent,
  Payer,
  PropertyKind,
  TenantApprovalStatus,
};

export type GuaranteeDocumentKey = DocumentKey;

export type GuaranteeDocument = {
  key: GuaranteeDocumentKey;
  status: DocumentStatus;
};

export type GuaranteeHistoryEntry = {
  at: string;
  username: string;
  message: string;
};

type GuaranteeTenantShared = {
  approvalStatus: TenantApprovalStatus;
  termApprovedAt: string | null;
  taxId: string;
  fullName: string;
  email: string;
  phone: string;
};

export type GuaranteeTenantPf = GuaranteeTenantShared & {
  entityType: "pf";
  birthDate: string;
};

export type GuaranteeTenantPj = GuaranteeTenantShared & {
  entityType: "pj";
  contactCpf?: string;
};

export type GuaranteeTenant = GuaranteeTenantPf | GuaranteeTenantPj;

/** The lease a guarantee covers, as the detail query projects it. */
export type GuaranteeLease = {
  id: string;
  propertyKind: PropertyKind;
  property: LeaseProperty;
  tag: string;
  description: string;
  rent: LeaseRent;
  payer: Payer;
};

/** Mirror of `shapeGuarantee` in `convex/guarantees/useCases.ts`. */
export type Guarantee = {
  id: string;
  agencyId: AgencyId;
  status: GuaranteeState;
  closure: GuaranteeClosure | null;
  activatedAt: string | null;
  nextRenewalDate: string;
  underwriting: GuaranteeUnderwriting;
  terms: GuaranteeTerms;
  capacity: GuaranteeCapacity;
  documents: GuaranteeDocument[];
  lease: GuaranteeLease;
  tenant: GuaranteeTenant;
  history: GuaranteeHistoryEntry[];
};
