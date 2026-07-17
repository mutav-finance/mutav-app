import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { DEFAULT_TENANT_ENTITY_TYPE } from "./contracts/domain";
import { buildTenantRegistryPatch } from "./tenants/useCases";

export const migrations = new Migrations<DataModel>(components.migrations);

/**
 * No-op sentinel kept at the head of `runAll`. The component's runner errors on
 * an empty list, so this guarantees `runAll` is always a valid, safe no-op —
 * letting the deploy-time migration step ship before any real migration exists.
 * It scans `users` once per deployment, marks itself complete, then is skipped
 * on every subsequent deploy.
 */
export const noop = migrations.define({
  table: "users",
  migrateOne: () => {},
});

/**
 * Step 1 of removing the deprecated `users.isStaff` flag (superseded by the
 * `mutavStaff` table). Clears the field from every `users` doc so a follow-up PR
 * can narrow it out of the schema without hitting the deploy-order trap (Convex
 * validates the narrowed schema against data at rest before in-deploy migrations
 * run). Schema is unchanged here — `isStaff` stays optional until that step-2 PR.
 *
 * Returning `undefined` for an already-clean doc skips the write, so re-runs on
 * deploy are no-ops. See issue #207 and the `convex/schema.ts` deprecation note.
 */
export const clearUsersIsStaff = migrations.define({
  table: "users",
  migrateOne: (_ctx, user) => (user.isStaff === undefined ? undefined : { isStaff: undefined }),
});

/**
 * Step 1 of #60 (make `contracts.tenant` a discriminated union on `entityType`).
 * Backfills `tenant.entityType` to `"pf"` on every contract that predates the
 * field, so a follow-up PR can narrow `tenant` into a `v.union` with a required
 * `entityType` literal without tripping the deploy-order trap. Returning
 * `undefined` for docs that already carry an `entityType` skips the write, so
 * re-runs on deploy are no-ops. `tenant` is patched as a whole object (Convex
 * patch merges only at the top level), spreading the existing value.
 */
export const backfillTenantEntityType = migrations.define({
  table: "contracts",
  migrateOne: (_ctx, contract) =>
    contract.tenant.entityType === undefined
      ? { tenant: { ...contract.tenant, entityType: DEFAULT_TENANT_ENTITY_TYPE } }
      : undefined,
});

/**
 * Widen-phase backfill of the tenant registry (2026-07-17 spec): walks
 * contracts in `_creationTime` order and links each to a `tenants` row
 * resolved from the embedded tenant via `getOrCreateTenant` — so dedup is
 * first-created-wins (later conflicting fullName/birthDate values are
 * audit-logged by the helper, contacts last-write-win), and the contract
 * is patched with `tenantId` + `tenantApproval` mirrored from the embedded
 * approval fields. Rows already carrying `tenantId` are skipped
 * (idempotent re-runs); rows whose embedded tenant cannot be normalized
 * (checksum-invalid document, pf without birthDate) stay legacy-only —
 * the widened schema tolerates them until the data is corrected.
 */
export const backfillContractTenantRegistry = migrations.define({
  table: "contracts",
  migrateOne: async (ctx, contract) =>
    buildTenantRegistryPatch(ctx, contract, {
      kind: "system",
      source: "migrations.backfillContractTenantRegistry",
    }),
});

/**
 * Ordered runner of all data migrations. Chained after `convex deploy` in every
 * app's `vercel.json` (`scripts/run-migrations.sh`), so each deploy backfills
 * data in place — no wipe/reseed, and every developer's own dev deployment
 * self-heals on `convex dev`. Completed migrations are skipped on re-run.
 *
 * Migration convention (widen → migrate → narrow, two PRs — see
 * `.claude/notes/deferred-conventions.md`): in the WIDEN PR set
 * `schemaValidation: false` (or add the new field as optional), define the
 * migration with `migrations.define({ table, migrateOne })`, and append its
 * `internal.migrations.<name>` here. In the NARROW PR re-enable strict
 * validation and drop the transitional fields.
 */
export const runAll = migrations.runner([
  internal.migrations.noop,
  internal.migrations.clearUsersIsStaff,
  internal.migrations.backfillTenantEntityType,
  internal.migrations.backfillContractTenantRegistry,
]);
