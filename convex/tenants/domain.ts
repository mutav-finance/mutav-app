import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { digitsOnly, isValidCNPJ, isValidCPF } from "../lib/taxId";

export type Tenant = Doc<"tenants">;
export type TenantId = Id<"tenants">;
export type PfTenant = Extract<Tenant, { entityType: "pf" }>;
export type PjTenant = Extract<Tenant, { entityType: "pj" }>;
export type TenantEntityType = Tenant["entityType"];

/**
 * Whether a tenant is a natural person (`pf`, CPF) or a legal entity
 * (`pj`, CNPJ). Discriminates the `tenants` table union; also still
 * persisted on the legacy embedded `contracts.tenant` object until the
 * narrow phase drops it.
 */
export const TENANT_ENTITY_TYPE = {
  PF: "pf",
  PJ: "pj",
} as const satisfies Record<Uppercase<TenantEntityType>, TenantEntityType>;

export const tenantEntityTypeValidator = v.union(
  v.literal(TENANT_ENTITY_TYPE.PF),
  v.literal(TENANT_ENTITY_TYPE.PJ),
);

export const DEFAULT_TENANT_ENTITY_TYPE: TenantEntityType = TENANT_ENTITY_TYPE.PF;

export const TENANT_ERROR_CODE = {
  INVALID_TAX_ID: "INVALID_TAX_ID",
} as const satisfies Record<string, string>;

export type TenantErrorCode = (typeof TENANT_ERROR_CODE)[keyof typeof TENANT_ERROR_CODE];

/** Registry write payload — the tenant row minus system fields. */
export type PfTenantInput = Omit<PfTenant, "_id" | "_creationTime">;
export type PjTenantInput = Omit<PjTenant, "_id" | "_creationTime">;
export type TenantInput = PfTenantInput | PjTenantInput;

export const tenantInputValidator = v.union(
  v.object({
    entityType: v.literal(TENANT_ENTITY_TYPE.PF),
    taxId: v.string(),
    fullName: v.string(),
    birthDate: v.string(),
    email: v.string(),
    phone: v.string(),
  }),
  v.object({
    entityType: v.literal(TENANT_ENTITY_TYPE.PJ),
    taxId: v.string(),
    fullName: v.string(),
    contactCpf: v.optional(v.string()),
    email: v.string(),
    phone: v.string(),
  }),
);

export type ValidateTaxIdResult =
  | { valid: true; taxId: string }
  | { valid: false; code: typeof TENANT_ERROR_CODE.INVALID_TAX_ID };

/**
 * Digits-normalize then checksum-validate a tax ID for the given entity
 * type. Returns the normalized digits on success so callers persist the
 * canonical at-rest form.
 */
export function validateTaxId(args: {
  entityType: TenantEntityType;
  taxId: string;
}): ValidateTaxIdResult {
  const digits = digitsOnly(args.taxId);
  const valid =
    args.entityType === TENANT_ENTITY_TYPE.PF ? isValidCPF(digits) : isValidCNPJ(digits);
  if (!valid) return { valid: false, code: TENANT_ERROR_CODE.INVALID_TAX_ID };
  return { valid: true, taxId: digits };
}

const CPF_LENGTH = 11;

/**
 * What one agency submitted for a tenant, frozen on its contract creation
 * event. Structurally the `contractHistory.tenantSnapshot` shape, declared
 * here because the value it maps to (`TenantInput`) is this domain's.
 */
export type TenantSubmission = {
  entityType: TenantEntityType;
  taxId: string;
  fullName: string;
  email: string;
  phone: string;
  birthDate?: string;
  contactCpf?: string;
};

/**
 * Read an agency's own submission back as a registry-shaped value, or `null`
 * when the submission predates the snapshot (legacy/seeded rows) or cannot be
 * discriminated without fabricating data (pf without birthDate). Callers fall
 * back to the registry row only on `null` — the registry is shared across
 * agencies and keeps its first writer's values (LGPD-26).
 */
export function tenantInputFromSubmission(submission: TenantSubmission): TenantInput | null {
  if (submission.entityType === TENANT_ENTITY_TYPE.PJ) {
    return {
      entityType: TENANT_ENTITY_TYPE.PJ,
      taxId: submission.taxId,
      fullName: submission.fullName,
      ...(submission.contactCpf === undefined ? {} : { contactCpf: submission.contactCpf }),
      email: submission.email,
      phone: submission.phone,
    };
  }
  if (!submission.birthDate) return null;
  return {
    entityType: TENANT_ENTITY_TYPE.PF,
    taxId: submission.taxId,
    fullName: submission.fullName,
    birthDate: submission.birthDate,
    email: submission.email,
    phone: submission.phone,
  };
}

/**
 * The registry row as a write-shaped value — drops the system fields so a
 * caller can hand the same union to readers that also accept an agency's own
 * submission. Fallback only: the registry is shared across agencies (LGPD-26).
 */
export function tenantInputFromRegistry(tenant: Tenant): TenantInput {
  if (tenant.entityType === TENANT_ENTITY_TYPE.PJ) {
    return {
      entityType: TENANT_ENTITY_TYPE.PJ,
      taxId: tenant.taxId,
      fullName: tenant.fullName,
      ...(tenant.contactCpf === undefined ? {} : { contactCpf: tenant.contactCpf }),
      email: tenant.email,
      phone: tenant.phone,
    };
  }
  return {
    entityType: TENANT_ENTITY_TYPE.PF,
    taxId: tenant.taxId,
    fullName: tenant.fullName,
    birthDate: tenant.birthDate,
    email: tenant.email,
    phone: tenant.phone,
  };
}

/**
 * Legacy embedded `contracts.tenant` shape relevant to registry
 * normalization (approval/score fields stay contract-level).
 */
export type EmbeddedTenantSnapshot = {
  entityType?: TenantEntityType;
  fullName: string;
  cpf: string;
  cnpj?: string;
  birthDate: string;
  email: string;
  phone: string;
};

/**
 * Map a legacy embedded tenant to a registry input, or `null` when the row
 * cannot be normalized without fabricating data (missing/checksum-invalid
 * billed document, pf without birthDate) — such rows stay legacy-only until
 * corrected. Legacy pj rows may carry the CNPJ in the `cpf` field, so pj
 * resolves the tax ID from `cnpj` digits when present and falls back to
 * `cpf`; `contactCpf` is set only when a real CNPJ exists alongside a
 * CPF-length document — never fabricated as "".
 */
export function normalizeEmbeddedTenant(tenant: EmbeddedTenantSnapshot): TenantInput | null {
  const entityType = tenant.entityType ?? DEFAULT_TENANT_ENTITY_TYPE;

  if (entityType === TENANT_ENTITY_TYPE.PJ) {
    const cnpjDigits = digitsOnly(tenant.cnpj ?? "");
    const cpfDigits = digitsOnly(tenant.cpf);
    const taxId = cnpjDigits.length > 0 ? cnpjDigits : cpfDigits;
    if (!isValidCNPJ(taxId)) return null;
    const contactCpf =
      cnpjDigits.length > 0 && cpfDigits.length === CPF_LENGTH ? cpfDigits : undefined;
    return {
      entityType: TENANT_ENTITY_TYPE.PJ,
      taxId,
      fullName: tenant.fullName,
      ...(contactCpf === undefined ? {} : { contactCpf }),
      email: tenant.email,
      phone: tenant.phone,
    };
  }

  const taxId = digitsOnly(tenant.cpf);
  if (!isValidCPF(taxId)) return null;
  if (!tenant.birthDate) return null;
  return {
    entityType: TENANT_ENTITY_TYPE.PF,
    taxId,
    fullName: tenant.fullName,
    birthDate: tenant.birthDate,
    email: tenant.email,
    phone: tenant.phone,
  };
}
