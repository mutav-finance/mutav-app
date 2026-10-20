import { describe, expect, test } from "vitest";
import type { EnvPresence } from "../lib/env";
import { assessReadiness, type ReadinessInput } from "./domain";

const LAUNCH_VAR: EnvPresence = {
  name: "PII_HMAC_KEY",
  requirement: "launch",
  feature: "CPF/CNPJ lookups and claims",
  set: true,
};

const READY: ReadinessInput = {
  env: [LAUNCH_VAR],
  auth0Domain: "mutav-prod.us.auth0.com",
  scoreProvider: "bigdatacorp",
  stellarNetwork: "public",
  etherfuseBaseUrl: "https://api.etherfuse.com",
  deploymentLocked: true,
  staffAdminCount: 1,
  defaultProductPresent: true,
};

describe("assessReadiness", () => {
  test("a fully configured deployment is ready with no findings", () => {
    expect(assessReadiness(READY)).toEqual({ ready: true, blockers: [], warnings: [] });
  });

  test.each<[string, Partial<ReadinessInput>, string]>([
    ["a launch variable is unset", { env: [{ ...LAUNCH_VAR, set: false }] }, "ENV_MISSING"],
    [
      "the dev Auth0 tenant",
      { auth0Domain: "dev-ay46ib0hhi1mdwpw.us.auth0.com" },
      "DEV_AUTH0_TENANT",
    ],
    ["the mock bureau", { scoreProvider: "mock" }, "MOCK_CREDIT_SCORE"],
    ["an unlocked deployment", { deploymentLocked: false }, "DEPLOYMENT_NOT_LOCKED"],
    ["no staff admin", { staffAdminCount: 0 }, "NO_STAFF_ADMIN"],
    ["no default product", { defaultProductPresent: false }, "NO_DEFAULT_PRODUCT"],
  ])("blocks on %s", (_label, override, code) => {
    const report = assessReadiness({ ...READY, ...override });

    expect(report.ready).toBe(false);
    expect(report.blockers.map((b) => b.code)).toEqual([code]);
  });

  test("an unset feature variable is neither a blocker nor a warning", () => {
    const report = assessReadiness({
      ...READY,
      env: [{ name: "WHATSAPP_API_KEY", requirement: "feature", feature: "WhatsApp", set: false }],
    });

    expect(report).toEqual({ ready: true, blockers: [], warnings: [] });
  });

  test("sandboxed payment rails warn without blocking", () => {
    const report = assessReadiness({
      ...READY,
      stellarNetwork: "testnet",
      etherfuseBaseUrl: "https://api.sand.etherfuse.com",
    });

    expect(report.ready).toBe(true);
    expect(report.warnings.map((w) => w.code)).toEqual(["PAYMENTS_ON_TESTNET", "PIX_ON_SANDBOX"]);
  });
});
