#!/usr/bin/env bun
/**
 * Developer convenience: print the PII registry's drift against the schema.
 *
 *   bun run scripts/check-pii-registry.ts
 *
 * The merge gate is the vitest case in `convex/privacy/domain.test.ts`, which
 * runs inside the existing `test` CI job and needs no separate runner. Both
 * call `checkPiiRegistry` — the rule is written once, in
 * `convex/privacy/registryCheck.ts`. This script exists only so a developer can
 * see the gap without starting vitest.
 */

import schema from "../convex/schema";
import { checkPiiRegistry, formatFindings } from "../convex/privacy/registryCheck";

const findings = checkPiiRegistry(schema);

console.log(formatFindings(findings));

if (findings.length > 0) {
  console.log(`\n${findings.length} finding(s). See docs/architecture/privacy/ for the policy.`);
  process.exit(1);
}
