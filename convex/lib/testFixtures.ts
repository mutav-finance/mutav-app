import type { convexTest } from "convex-test";

/**
 * Pre-Auth0, `resolveCurrentUser` in `convex/lib/auth.ts` falls back to
 * the user row with this publicId. Tests seed it before exercising
 * wrapped handlers. Drop with the Auth0 swap (see docs/auth.md).
 */
export const DEV_USER_PUBLIC_ID = "dev-user";

export async function seedDevUser(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: DEV_USER_PUBLIC_ID,
      name: "Dev User",
      email: "dev@mutav.test",
      createdAt: new Date().toISOString(),
    }),
  );
}

export async function seedAgencyWithMembership(
  t: ReturnType<typeof convexTest>,
  userId: Awaited<ReturnType<typeof seedDevUser>>,
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
