import type { convexTest } from "convex-test";
import type { AgencyId } from "../agencies/domain";
import { tierForScore } from "../contracts/domain";
import { hashPii } from "./pii";
import aggregateComponentSchema from "../../node_modules/@convex-dev/aggregate/src/component/schema";
import migrationsComponentSchema from "../../node_modules/@convex-dev/migrations/src/component/schema";

declare global {
  interface ImportMeta {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
}

export const TEST_USER_SUBJECT = "auth0|test-user";

/**
 * Register the three contract aggregate components used by production code
 * paths. Mirrors the `app.use(aggregate, { name })` calls in
 * `convex.config.ts`. Tests that exercise mutations writing to aggregates
 * MUST call this on their `convexTest` instance before invoking the code.
 */
export function registerContractAggregateComponents(t: ReturnType<typeof convexTest>): void {
  const componentGlob = import.meta.glob(
    "../../node_modules/@convex-dev/aggregate/src/component/**/*.ts",
  );
  for (const name of [
    "contractsByStatus",
    "contractsByStatusPlatform",
    "ativoInsuredCentsPlatform",
  ]) {
    t.registerComponent(name, aggregateComponentSchema, componentGlob);
  }
}

/**
 * Register the `@convex-dev/migrations` component used by the deploy-time
 * migration runner. Mirrors `app.use(migrations)` in `convex.config.ts`. Tests
 * that run a `migrations.define`-based migration MUST call this on their
 * `convexTest` instance before invoking it.
 */
export function registerMigrationsComponent(t: ReturnType<typeof convexTest>): void {
  const componentGlob = import.meta.glob(
    "../../node_modules/@convex-dev/migrations/src/component/**/*.ts",
  );
  t.registerComponent("migrations", migrationsComponentSchema, componentGlob);
}

type SeedUserOptions = {
  subject?: string;
  email?: string;
  name?: string;
};

export async function seedAuthenticatedUser(
  t: ReturnType<typeof convexTest>,
  options: SeedUserOptions = {},
) {
  const subject = options.subject ?? TEST_USER_SUBJECT;
  return t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: `user-${subject.replace(/[^a-zA-Z0-9-]/g, "-")}`,
      subject,
      name: options.name ?? "Test User",
      email: options.email ?? "test@mutav.test",
      createdAt: new Date().toISOString(),
    }),
  );
}

export async function setupAuthenticatedUser(
  t: ReturnType<typeof convexTest>,
  options: SeedUserOptions = {},
) {
  const userId = await seedAuthenticatedUser(t, options);
  const subject = options.subject ?? TEST_USER_SUBJECT;
  const asUser = t.withIdentity({ subject });
  return { asUser, userId, subject };
}

export type SeededUserId = Awaited<ReturnType<typeof seedAuthenticatedUser>>;

export async function seedAgencyWithMembership(
  t: ReturnType<typeof convexTest>,
  userId: SeededUserId,
) {
  return t.run(async (ctx) => {
    const agencyId = await ctx.db.insert("agencies", {
      name: "Mutav Test Agency",
      cnpj: "00000000000100",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: "owner",
      joinedAt: new Date().toISOString(),
    });
    return agencyId;
  });
}

export async function seedForeignAgency(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.db.insert("agencies", {
      name: "Foreign Agency",
      cnpj: "00000000000200",
      agencyType: "empresa",
      onboardingState: "active",
      createdAt: new Date().toISOString(),
    }),
  );
}

/**
 * Record a fresh, successful credit assessment for a tenant document.
 *
 * `contracts.create` re-reads the score from this row rather than trusting the
 * caller, so any test that creates a contract has to establish the assessment
 * the agency would really have pulled first.
 */
export async function seedFreshCreditAssessment(
  t: ReturnType<typeof convexTest>,
  args: { agencyId: AgencyId; document: string; score: number },
) {
  const subjectHash = await hashPii(args.document.replace(/\D/g, ""));
  return t.run((ctx) =>
    ctx.db.insert("creditAnalysisAssessments", {
      agencyId: args.agencyId,
      subjectType: "tenant",
      subjectHash,
      policyVersion: "test",
      signalIds: [],
      status: "ok",
      score: args.score,
      tier: tierForScore(args.score),
      assessedAt: Date.now(),
    }),
  );
}
