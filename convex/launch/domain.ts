import type { EnvPresence } from "../lib/env";

/** The dev tenant every test persona lives on (`docs/test-personas.md`). */
export const DEV_AUTH0_DOMAIN = "dev-ay46ib0hhi1mdwpw.us.auth0.com";

export const MOCK_SCORE_PROVIDER = "mock";

const SANDBOX_HOST_MARKER = ".sand.";

export const LAUNCH_BLOCKER = {
  ENV_MISSING: "ENV_MISSING",
  DEV_AUTH0_TENANT: "DEV_AUTH0_TENANT",
  MOCK_CREDIT_SCORE: "MOCK_CREDIT_SCORE",
  DEPLOYMENT_NOT_LOCKED: "DEPLOYMENT_NOT_LOCKED",
  NO_STAFF_ADMIN: "NO_STAFF_ADMIN",
  NO_DEFAULT_PRODUCT: "NO_DEFAULT_PRODUCT",
} as const;

export type LaunchBlockerCode = (typeof LAUNCH_BLOCKER)[keyof typeof LAUNCH_BLOCKER];

export const LAUNCH_WARNING = {
  PAYMENTS_ON_TESTNET: "PAYMENTS_ON_TESTNET",
  PIX_ON_SANDBOX: "PIX_ON_SANDBOX",
} as const;

export type LaunchWarningCode = (typeof LAUNCH_WARNING)[keyof typeof LAUNCH_WARNING];

export type LaunchFinding<TCode> = { code: TCode; detail: string };

export type ReadinessInput = {
  env: readonly EnvPresence[];
  auth0Domain: string;
  scoreProvider: string;
  stellarNetwork: "testnet" | "public";
  etherfuseBaseUrl: string;
  deploymentLocked: boolean;
  staffAdminCount: number;
  defaultProductPresent: boolean;
};

export type ReadinessReport = {
  ready: boolean;
  blockers: LaunchFinding<LaunchBlockerCode>[];
  warnings: LaunchFinding<LaunchWarningCode>[];
};

/**
 * Go / no-go for onboarding the first real agency. Blockers stop launch;
 * warnings describe features that stay off or sandboxed (payment rails are
 * outside the first-agency scope).
 */
export function assessReadiness(input: ReadinessInput): ReadinessReport {
  const blockers: LaunchFinding<LaunchBlockerCode>[] = [];
  const warnings: LaunchFinding<LaunchWarningCode>[] = [];

  for (const entry of input.env) {
    if (entry.requirement === "launch" && !entry.set) {
      blockers.push({
        code: LAUNCH_BLOCKER.ENV_MISSING,
        detail: `${entry.name} — ${entry.feature}`,
      });
    }
  }
  if (input.auth0Domain === DEV_AUTH0_DOMAIN) {
    blockers.push({
      code: LAUNCH_BLOCKER.DEV_AUTH0_TENANT,
      detail: "AUTH0_DOMAIN is the dev tenant, whose test personas have a published password",
    });
  }
  if (input.scoreProvider === MOCK_SCORE_PROVIDER) {
    blockers.push({
      code: LAUNCH_BLOCKER.MOCK_CREDIT_SCORE,
      detail: "SCORE_PROVIDER is mock; scores are derived from the CPF's last digits",
    });
  }
  if (!input.deploymentLocked) {
    blockers.push({
      code: LAUNCH_BLOCKER.DEPLOYMENT_NOT_LOCKED,
      detail: "run seed:lockForRealData so a reseed cannot wipe real data",
    });
  }
  if (input.staffAdminCount === 0) {
    blockers.push({
      code: LAUNCH_BLOCKER.NO_STAFF_ADMIN,
      detail: "no staff admin can review onboarding; run mutavStaff:bootstrapFirstAdmin",
    });
  }
  if (!input.defaultProductPresent) {
    blockers.push({
      code: LAUNCH_BLOCKER.NO_DEFAULT_PRODUCT,
      detail: "no enabled default product; the guarantee wizard cannot price",
    });
  }

  if (input.stellarNetwork === "testnet") {
    warnings.push({
      code: LAUNCH_WARNING.PAYMENTS_ON_TESTNET,
      detail: "STELLAR_NETWORK is testnet",
    });
  }
  if (input.etherfuseBaseUrl.includes(SANDBOX_HOST_MARKER)) {
    warnings.push({
      code: LAUNCH_WARNING.PIX_ON_SANDBOX,
      detail: "ETHERFUSE_BASE_URL is the sandbox",
    });
  }

  return { ready: blockers.length === 0, blockers, warnings };
}
