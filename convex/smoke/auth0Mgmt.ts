"use node";

import { internalAction } from "../_generated/server";
import { getMgmtTenantInfo } from "../lib/auth0Mgmt";

/**
 * Smoke test for M2M credentials. Run from the CLI:
 *
 *   bunx convex run smoke/auth0Mgmt:verifyMgmtConnection
 *
 * Returns `null` for `friendlyName` when the Auth0 tenant has no
 * `friendly_name` configured — distinct from "the API call failed".
 */
export const verifyMgmtConnection = internalAction({
  args: {},
  handler: async (): Promise<{ friendlyName: string | null }> => {
    const info = await getMgmtTenantInfo();
    return { friendlyName: info.friendly_name ?? null };
  },
});
