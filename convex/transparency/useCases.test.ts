// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeAll, describe, expect, test } from "vitest";
import { api, internal } from "../_generated/api";
import schema from "../schema";

beforeAll(() => {
  process.env.PII_ENCRYPTION_KEY = Buffer.from(new Uint8Array(32).fill(0xaa)).toString("base64");
  process.env.PII_HMAC_KEY = Buffer.from(new Uint8Array(32).fill(0xbb)).toString("base64");
});

// getReserveCoverage is wrapped in queryWithAuth, which requires a provisioned
// user row matched by JWT subject. Provision one and call via withIdentity so the
// auth wrapper resolves — the coverage behavior under test is unchanged.
async function authedReader() {
  const t = convexTest(schema);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      publicId: "reader",
      subject: "auth0|reader",
      name: "Reader",
      email: "reader@test.br",
      createdAt: new Date().toISOString(),
    }),
  );
  return t.withIdentity({ subject: "auth0|reader", email: "reader@test.br", name: "Reader" });
}

describe("getReserveCoverage", () => {
  test("reports unavailable with the testnet contract explorer url when no snapshot exists", async () => {
    const reader = await authedReader();
    const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(false);
    expect(typeof coverage.explorerUrl).toBe("string");
    expect(coverage.explorerUrl).toContain("/contract/");
  });

  test("explorer url omits /contract/ when no contract id is configured (public net, unset)", async () => {
    const original = process.env.STELLAR_NETWORK; // hook-ok: test env manipulation for isolation
    process.env.STELLAR_NETWORK = "public"; // hook-ok: test env manipulation for isolation
    delete process.env.STELLAR_RESERVE_CONTRACT_ID; // hook-ok: test env manipulation for isolation
    try {
      const reader = await authedReader();
      const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
      expect(coverage.available).toBe(false);
      expect(coverage.explorerUrl).not.toContain("/contract/");
      expect(coverage.explorerUrl.endsWith("/explorer/public")).toBe(true);
    } finally {
      if (original === undefined)
        delete process.env.STELLAR_NETWORK; // hook-ok: test env manipulation for isolation
      else process.env.STELLAR_NETWORK = original; // hook-ok: test env manipulation for isolation
    }
  });

  test("returns the latest snapshot when one exists", async () => {
    const reader = await authedReader();
    await reader.mutation(internal.reserve.useCases.writeSnapshot, {
      storedValueCents: 50784300,
      fxUsdBrl: 5.42,
      fxSource: "BCB_PTAX_VENDA",
      fxQuotedAt: "2026-06-10 13:12:50",
      assets: [
        {
          contractAddress: "C1",
          symbol: "BRLT",
          decimals: 7,
          rawBalance: "5078430000000",
          valueCents: 50784300,
        },
      ],
      capturedAt: 1717000000000,
    });
    const coverage = await reader.query(api.transparency.useCases.getReserveCoverage, {});
    expect(coverage.available).toBe(true);
    if (coverage.available) {
      expect(coverage.storedValueCents).toBe(50784300);
      expect(coverage.capturedAt).toBe(1717000000000);
      expect(coverage.assetCount).toBe(1);
    }
  });
});
