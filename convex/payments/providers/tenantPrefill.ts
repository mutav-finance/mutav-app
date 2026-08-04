import type { TenantInput } from "../../tenants/domain";

export type TenantPrefill = {
  first_name?: string;
  last_name?: string;
  email_address?: string;
  id_number?: string;
};

/**
 * Map a tenant identity to SEP-9 prefill fields. Takes the write-shaped
 * `TenantInput` so callers can pass an agency's own submission as readily as a
 * registry row. `id_number` is a PERSONAL document in SEP-9: pf sends the CPF
 * tax id; pj sends the contact CPF when known and omits the field otherwise —
 * never the CNPJ, which would seed the anchor's natural-person KYC with a
 * company document.
 */
export function tenantToSep9Prefill(tenant: TenantInput): TenantPrefill {
  const fullName = tenant.fullName.trim();
  const [first, ...rest] = fullName.split(/\s+/);
  const idNumber = tenant.entityType === "pf" ? tenant.taxId : tenant.contactCpf;
  return {
    first_name: first || undefined,
    last_name: rest.length > 0 ? rest.join(" ") : undefined,
    email_address: tenant.email || undefined,
    id_number: idNumber || undefined,
  };
}
