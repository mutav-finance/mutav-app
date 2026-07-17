import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

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

type LegacyEmbeddedTenantProbe = {
  hasLegacyFields: boolean;
  hasRegistryLink: boolean;
  embeddedScore: number | undefined;
};

/**
 * `in`-operator probe over the raw doc: the narrowed schema no longer types
 * the legacy embedded `tenant`/`tenantCpf` fields, so any straggler data is
 * only reachable as `unknown`.
 */
function probeLegacyEmbeddedTenant(doc: object): LegacyEmbeddedTenantProbe {
  const hasLegacyFields =
    ("tenant" in doc && doc.tenant !== undefined) ||
    ("tenantCpf" in doc && doc.tenantCpf !== undefined);
  const hasRegistryLink =
    "tenantId" in doc &&
    doc.tenantId !== undefined &&
    "tenantApproval" in doc &&
    doc.tenantApproval !== undefined;

  let embeddedScore: number | undefined;
  if ("tenant" in doc) {
    const embedded: unknown = doc.tenant;
    if (typeof embedded === "object" && embedded !== null && "score" in embedded) {
      const score: unknown = embedded.score;
      if (typeof score === "number") embeddedScore = score;
    }
  }

  return { hasLegacyFields, hasRegistryLink, embeddedScore };
}

/**
 * Narrow-phase cleanup of the tenant-registry migration: strips the orphaned
 * embedded `tenant`/`tenantCpf` fields left at rest by the widen phase
 * (`backfillContractTenantRegistry`, retired from this file once it completed
 * everywhere — the deploy gate for this PR). Preserves the embedded
 * `tenant.score` as the contract-level `score` snapshot.
 *
 * `db.replace` with the enumerated schema fields is the removal mechanism —
 * a patch can't unset fields the schema no longer types. A straggler that
 * still lacks its registry link cannot be auto-fixed and throws: the deploy
 * gate asserts zero such rows before this migration runs.
 */
export const clearContractEmbeddedTenant = migrations.define({
  table: "contracts",
  migrateOne: async (ctx, contract) => {
    const probe = probeLegacyEmbeddedTenant(contract);
    if (!probe.hasLegacyFields) return undefined;
    if (!probe.hasRegistryLink) {
      throw new Error(
        `Contract ${contract.publicId} still carries embedded tenant data but no tenantId/` +
          `tenantApproval — run the widen-phase backfillContractTenantRegistry (PR A) on this ` +
          `deployment before deploying the narrowed schema`,
      );
    }
    await ctx.db.replace(contract._id, {
      agencyId: contract.agencyId,
      publicId: contract.publicId,
      tenantId: contract.tenantId,
      tenantApproval: contract.tenantApproval,
      score: contract.score ?? probe.embeddedScore,
      status: contract.status,
      activatedAt: contract.activatedAt,
      deactivatedAt: contract.deactivatedAt,
      nextRenewalDate: contract.nextRenewalDate,
      availableGuaranteeCents: contract.availableGuaranteeCents,
      rental: contract.rental,
      property: contract.property,
      optional: contract.optional,
      documents: contract.documents,
    });
  },
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
 * validation and drop the transitional fields. Completed widen-phase
 * migrations whose code can no longer compile against the narrowed schema
 * (`backfillTenantEntityType`, `backfillContractTenantRegistry`) are removed
 * once the deploy gate confirms they ran everywhere.
 */
export const runAll = migrations.runner([
  internal.migrations.noop,
  internal.migrations.clearUsersIsStaff,
  internal.migrations.clearContractEmbeddedTenant,
]);
