import type { convexTest } from "convex-test";

export const TEST_USER_SUBJECT = "auth0|test-user";

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
