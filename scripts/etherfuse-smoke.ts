/**
 * Etherfuse sandbox smoke test.
 *
 * Walks through the business-KYB child-org flow end-to-end, with explicit
 * empirical tests for the two unknowns we couldn't answer from the OpenAPI
 * spec alone:
 *
 *   1. Does `stellarAddress` accept Stellar muxed M-addresses?
 *   2. Does business KYB sandbox auto-approve, or require manual review?
 *
 * Usage:
 *
 *   1. Sign up at https://devnet.etherfuse.com (email + fake KYC data)
 *   2. Sidebar → Ramp → API Keys → Create Key
 *   3. Export the key:
 *        export ETHERFUSE_API_KEY=api_sand:...
 *      Optionally override base URL (defaults to sandbox):
 *        export ETHERFUSE_BASE_URL=https://api.sand.etherfuse.com
 *      Optionally provide a treasury G-address to test M-address composition:
 *        export TEST_TREASURY_G=GA....
 *   4. Run:
 *        bun scripts/etherfuse-smoke.ts
 *
 * The script never modifies our codebase or schema — it only POSTs against
 * the Etherfuse sandbox and prints results. Safe to run repeatedly.
 */

import { Account, MuxedAccount } from "@stellar/stellar-base";

const API_KEY = process.env.ETHERFUSE_API_KEY;
const BASE_URL = process.env.ETHERFUSE_BASE_URL ?? "https://api.sand.etherfuse.com";
const TEST_TREASURY_G = process.env.TEST_TREASURY_G;
const TESOURO_ISSUER = "GC3CW7EDYRTWQ635VDIGY6S4ZUF5L6TQ7AA4MWS7LEQDBLUSZXV7UPS4";

if (!API_KEY) {
  console.error("ETHERFUSE_API_KEY is required. See script header for setup.");
  process.exit(1);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

type RequestResult = {
  ok: boolean;
  status: number;
  body: unknown;
};

async function request(
  method: "GET" | "POST" | "PATCH" | "PUT",
  path: string,
  body?: unknown,
): Promise<RequestResult> {
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: API_KEY!,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

// ─── Step runner ──────────────────────────────────────────────────────────────

type StepOutcome = "pass" | "fail" | "warn" | "skip";

const results: { name: string; outcome: StepOutcome; note?: string }[] = [];

async function step<T>(
  name: string,
  fn: () => Promise<{ outcome: StepOutcome; note?: string; value?: T }>,
): Promise<T | undefined> {
  console.log(`\n━━━ ${name}`);
  try {
    const { outcome, note, value } = await fn();
    const symbol = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" }[outcome];
    console.log(`${symbol} ${outcome.toUpperCase()}${note ? ` — ${note}` : ""}`);
    results.push({ name, outcome, note });
    return value;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`✗ FAIL — uncaught: ${msg}`);
    results.push({ name, outcome: "fail", note: `uncaught: ${msg}` });
    return undefined;
  }
}

// ─── Run ──────────────────────────────────────────────────────────────────────

async function main() {
console.log(`Etherfuse smoke test against ${BASE_URL}`);
console.log(`API key prefix: ${API_KEY!.split(":")[0]}:…`);

// 1. Validate API key
const me = await step<{ id: string; displayName: string }>("Validate API key (GET /ramp/me)", async () => {
  const res = await request("GET", "/ramp/me");
  console.log(`  status ${res.status}, body: ${JSON.stringify(res.body)}`);
  if (!res.ok) return { outcome: "fail", note: `HTTP ${res.status}` };
  return { outcome: "pass", value: res.body as { id: string; displayName: string } };
});

// 2. List BRL assets (confirm TESOURO listed)
await step("List BRL assets (GET /ramp/assets?currency=BRL)", async () => {
  // Use a placeholder G-address; doc says wallet param is required but balance comes back null if not registered
  const placeholderWallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const res = await request(
    "GET",
    `/ramp/assets?blockchain=stellar&currency=BRL&wallet=${placeholderWallet}`,
  );
  console.log(`  status ${res.status}`);
  if (!res.ok) {
    console.log(`  body: ${JSON.stringify(res.body)}`);
    return { outcome: "fail", note: `HTTP ${res.status}` };
  }
  const assets = (res.body as { assets?: unknown[] })?.assets ?? [];
  console.log(`  returned ${assets.length} assets`);
  const tesouro = assets.find((a: any) => a?.symbol === "TESOURO" || a?.identifier?.startsWith("TESOURO:"));
  if (tesouro) {
    console.log(`  ✓ TESOURO present: ${JSON.stringify(tesouro)}`);
    return { outcome: "pass", note: "TESOURO listed under BRL" };
  }
  console.log(`  full asset list: ${JSON.stringify(assets, null, 2)}`);
  return { outcome: "warn", note: "TESOURO not found in BRL assets — check identifier format" };
});

// 3. Create a test business child organization
const testOrgName = `Smoke Test Agency ${new Date().toISOString().slice(0, 19)}`;
const childOrg = await step<{ organizationId: string; accountType: string }>(
  "Create business child org (POST /ramp/organization, accountType: 'business')",
  async () => {
    const res = await request("POST", "/ramp/organization", {
      displayName: testOrgName,
      accountType: "business",
      partnerFeeDefaultBps: 100, // 1% take rate (test value)
    });
    console.log(`  status ${res.status}`);
    console.log(`  body: ${JSON.stringify(res.body, null, 2)}`);
    if (!res.ok) return { outcome: "fail", note: `HTTP ${res.status}` };
    const value = res.body as { organizationId: string; accountType: string };
    if (value.accountType !== "business") {
      return { outcome: "warn", note: `created but accountType is '${value.accountType}'` };
    }
    return { outcome: "pass", note: `organizationId: ${value.organizationId}`, value };
  },
);

// 4. Check the child org's KYB status (does sandbox auto-approve businesses?)
if (childOrg) {
  await step("Check child org status (GET /ramp/customer/{id})", async () => {
    const res = await request("GET", `/ramp/customer/${childOrg.organizationId}`);
    console.log(`  status ${res.status}, body: ${JSON.stringify(res.body, null, 2)}`);
    if (!res.ok) return { outcome: "fail", note: `HTTP ${res.status}` };
    return { outcome: "pass" };
  });

  // Also check the KYC endpoint to see KYB-specific status
  await step("Check KYB status (GET /ramp/customer/{id}/kyc)", async () => {
    const res = await request("GET", `/ramp/customer/${childOrg.organizationId}/kyc`);
    console.log(`  status ${res.status}, body: ${JSON.stringify(res.body, null, 2)}`);
    if (res.status === 404) {
      return { outcome: "warn", note: "no KYB record yet — agency needs out-of-band onboarding" };
    }
    if (!res.ok) return { outcome: "fail", note: `HTTP ${res.status}` };
    const status = (res.body as any)?.status;
    if (status === "approved") {
      return { outcome: "pass", note: "sandbox auto-approved business org" };
    }
    return { outcome: "warn", note: `status is '${status}' — production KYB SLA applies` };
  });
}

// 5. THE CRITICAL TEST: does `stellarAddress` (or `walletAddress`) accept M-addresses?
const testGAddress = TEST_TREASURY_G ?? "GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC"; // any well-formed G works for shape testing
const testMuxedId = "9999999999999999"; // 64-bit string ID
let testMAddress: string | undefined;
try {
  const baseAccount = new Account(testGAddress, "0");
  const muxed = new MuxedAccount(baseAccount, testMuxedId);
  testMAddress = muxed.accountId();
  console.log(`\n[setup] Composed test M-address: ${testMAddress}`);
  console.log(`[setup] (from G=${testGAddress.slice(0, 8)}…, muxedId=${testMuxedId})`);
} catch (error) {
  console.error(`[setup] Failed to compose M-address: ${error}`);
}

if (childOrg && testMAddress) {
  await step("THE M-ADDRESS TEST (POST /ramp/quote with M-address as walletAddress)", async () => {
    const res = await request("POST", "/ramp/quote", {
      quoteId: crypto.randomUUID(),
      customerId: childOrg.organizationId,
      blockchain: "stellar",
      quoteAssets: {
        type: "onramp",
        sourceAsset: "BRL",
        targetAsset: `TESOURO:${TESOURO_ISSUER}`,
      },
      sourceAmount: "100.00",
      walletAddress: testMAddress, // ← THE CRITICAL FIELD
    });
    console.log(`  status ${res.status}`);
    console.log(`  body: ${JSON.stringify(res.body, null, 2)}`);
    if (res.ok) {
      return {
        outcome: "pass",
        note: "M-address ACCEPTED — Horizon watcher pattern works as-is",
      };
    }
    if (res.status === 400) {
      const err = (res.body as any)?.error ?? "";
      if (err.toLowerCase().includes("address") || err.toLowerCase().includes("public")) {
        return {
          outcome: "warn",
          note: "M-address REJECTED — fallback to G-address + webhook-correlation",
        };
      }
    }
    return { outcome: "fail", note: `HTTP ${res.status} — unexpected error, check body` };
  });

  // 6. Retry with G-address only (control test)
  await step("Control: same quote with G-address only", async () => {
    const res = await request("POST", "/ramp/quote", {
      quoteId: crypto.randomUUID(),
      customerId: childOrg.organizationId,
      blockchain: "stellar",
      quoteAssets: {
        type: "onramp",
        sourceAsset: "BRL",
        targetAsset: `TESOURO:${TESOURO_ISSUER}`,
      },
      sourceAmount: "100.00",
      walletAddress: testGAddress,
    });
    console.log(`  status ${res.status}`);
    console.log(`  body: ${JSON.stringify(res.body, null, 2)}`);
    if (res.ok) return { outcome: "pass", note: "G-address quote works" };
    return { outcome: "fail", note: `HTTP ${res.status} — unexpected` };
  });
}

// 7. List existing webhooks
await step("List webhooks (GET /ramp/webhooks)", async () => {
  const res = await request("GET", "/ramp/webhooks");
  console.log(`  status ${res.status}, body: ${JSON.stringify(res.body)}`);
  if (!res.ok) return { outcome: "fail", note: `HTTP ${res.status}` };
  const webhooks = (res.body as { webhooks?: unknown[] })?.webhooks ?? [];
  return { outcome: "pass", note: `${webhooks.length} webhook(s) registered` };
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n━━━ Summary ━━━");
for (const r of results) {
  const symbol = { pass: "✓", fail: "✗", warn: "⚠", skip: "○" }[r.outcome];
  console.log(`  ${symbol} ${r.name}${r.note ? ` — ${r.note}` : ""}`);
}
const failed = results.filter((r) => r.outcome === "fail").length;
const warned = results.filter((r) => r.outcome === "warn").length;
console.log(`\n${results.length} steps, ${failed} fail, ${warned} warn`);
process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
