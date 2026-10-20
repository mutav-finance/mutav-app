// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../_generated/api";
import schema from "../schema";
import { buildApprovedHtml, buildRejectedHtml, escapeHtml } from "./actions";

const AGENCY_EMAIL = "contato@imobiliaria.test";
const OWNER_EMAIL = "owner@imobiliaria.test";

type T = ReturnType<typeof convexTest>;

async function seedAgency(
  t: T,
  {
    state,
    email,
    rejectionReason,
  }: {
    state: "active" | "rejected" | "submitted";
    email?: string;
    rejectionReason?: string;
  },
) {
  return t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      publicId: "pub-owner",
      subject: "auth0|owner",
      name: "Owner",
      email: OWNER_EMAIL,
      createdAt: new Date().toISOString(),
    });
    const agencyId = await ctx.db.insert("agencies", {
      name: "Imobiliária Decisão",
      agencyType: "autonomo",
      onboardingState: state,
      onboardingRejectionReason: rejectionReason,
      email,
      createdAt: new Date().toISOString(),
    });
    await ctx.db.insert("memberships", {
      userId: ownerId,
      agencyId,
      role: "owner",
      joinedAt: new Date().toISOString(),
    });
    return agencyId;
  });
}

describe("getOnboardingDecisionDeliveryInternal", () => {
  test("uses the agency contact email when present", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, {
      state: "rejected",
      email: AGENCY_EMAIL,
      rejectionReason: "CNPJ divergente",
    });

    const delivery = await t.query(
      internal.agencies.adminUseCases.getOnboardingDecisionDeliveryInternal,
      { agencyId },
    );

    expect(delivery).toEqual({
      email: AGENCY_EMAIL,
      agencyName: "Imobiliária Decisão",
      onboardingState: "rejected",
      rejectionReason: "CNPJ divergente",
    });
  });

  test("falls back to the owner's user email when the agency has none", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { state: "active" });

    const delivery = await t.query(
      internal.agencies.adminUseCases.getOnboardingDecisionDeliveryInternal,
      { agencyId },
    );

    expect(delivery?.email).toBe(OWNER_EMAIL);
  });

  test("returns null for an agency that no longer exists", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { state: "active" });
    await t.run((ctx) => ctx.db.delete(agencyId));

    const delivery = await t.query(
      internal.agencies.adminUseCases.getOnboardingDecisionDeliveryInternal,
      { agencyId },
    );

    expect(delivery).toBeNull();
  });
});

describe("sendOnboardingDecisionEmail", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env.RESEND_API_KEY; // hook-ok: test fixture — direct env mutation is the only way to unset a secret for convex-test
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  test("reaches the vendor-config guard and skips without a Resend key", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { state: "active", email: AGENCY_EMAIL });

    await expect(
      t.action(internal.agencies.actions.sendOnboardingDecisionEmail, {
        agencyId,
        decision: "approved",
      }),
    ).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY not set"));
  });

  test("skips when the agency moved on before the email ran", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { state: "submitted", email: AGENCY_EMAIL });

    await t.action(internal.agencies.actions.sendOnboardingDecisionEmail, {
      agencyId,
      decision: "rejected",
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("state changed"), expect.anything());
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("RESEND_API_KEY not set"));
  });

  test("no-ops on an agency erased before execution", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { state: "active", email: AGENCY_EMAIL });
    await t.run((ctx) => ctx.db.delete(agencyId));

    await expect(
      t.action(internal.agencies.actions.sendOnboardingDecisionEmail, {
        agencyId,
        decision: "approved",
      }),
    ).resolves.toBeNull();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no deliverable contact"),
      expect.anything(),
    );
  });

  test("keeps the address out of what it logs", async () => {
    const t = convexTest(schema);
    const agencyId = await seedAgency(t, { state: "active", email: AGENCY_EMAIL });

    await t.action(internal.agencies.actions.sendOnboardingDecisionEmail, {
      agencyId,
      decision: "approved",
    });

    expect(JSON.stringify(warn.mock.calls)).not.toContain(AGENCY_EMAIL);
  });
});

describe("decision email templates", () => {
  test("escapeHtml neutralises markup in free text", () => {
    expect(escapeHtml(`<script>"x" & 'y'</script>`)).toBe(
      "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;",
    );
  });

  test("approved email links to the agency app", () => {
    const html = buildApprovedHtml({
      agencyName: "Imob <b>",
      signInLink: "https://app.mutav.test",
    });
    expect(html).toContain('href="https://app.mutav.test"');
    expect(html).toContain("Imob &lt;b&gt;");
    expect(html).not.toContain("Imob <b>");
  });

  test("rejected email carries the escaped reason and the resubmit link", () => {
    const html = buildRejectedHtml({
      agencyName: "Imob",
      reason: "CRECI <vencido>",
      resubmitLink: "https://app.mutav.test/onboarding/rejected",
    });
    expect(html).toContain("CRECI &lt;vencido&gt;");
    expect(html).toContain('href="https://app.mutav.test/onboarding/rejected"');
  });

  test("rejected email omits the reason block when there is none", () => {
    const html = buildRejectedHtml({
      agencyName: "Imob",
      reason: null,
      resubmitLink: "https://app.mutav.test/onboarding/rejected",
    });
    expect(html).not.toContain("Motivo informado");
  });
});
