import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * CI guard: every PUBLIC staff CAPABILITY in convex/mutavStaff/useCases.ts must
 * be built with an aud-bound wrapper (queryWithMutavStaff / mutationWithMutavStaff
 * / queryWithMutavRole / mutationWithMutavRole). The only public exports allowed
 * to use a bare/identity wrapper are the three cross-app identity/routing reads
 * in the allowlist — they report or grant membership, never exercise a power.
 *
 * This reads the SOURCE TEXT (no convex-test) so it fails loudly the moment a
 * future ungated admin function is added with a bare query/mutation or
 * queryWithAuth/mutationWithAuth.
 */

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "useCases.ts");
const source = readFileSync(sourcePath, "utf8");

const ALLOWLIST = new Set(["getMyStaff", "amIStaff", "syncFromIdentity"]);

const AUD_BOUND = new Set([
  "queryWithMutavStaff",
  "mutationWithMutavStaff",
  "queryWithMutavRole",
  "mutationWithMutavRole",
]);
const IDENTITY_WRAPPERS = new Set(["queryWithAuth", "mutationWithAuth"]);
const BARE = new Set(["query", "mutation"]);

// Capture the export name + the FIRST builder identifier after `=`. For the
// curried `queryWithMutavRole({ minRole: "compliance" })(...)` form this yields
// `queryWithMutavRole` — correctly recognized as aud-bound. Tolerant of
// arbitrary whitespace/newlines between tokens.
const EXPORT_RE = /export\s+const\s+(\w+)\s*=\s*([A-Za-z_]\w*)/g;

type ParsedExport = { name: string; wrapper: string };

function parseExports(text: string): ParsedExport[] {
  const out: ParsedExport[] = [];
  for (const match of text.matchAll(EXPORT_RE)) {
    const name = match[1];
    const wrapper = match[2];
    if (name && wrapper) out.push({ name, wrapper });
  }
  return out;
}

const exports = parseExports(source);

describe("mutavStaff/useCases staff-gate guard", () => {
  test("every staff capability is aud-bound (no ungated bare/identity exports)", () => {
    const violations = exports.filter(
      ({ name, wrapper }) =>
        !ALLOWLIST.has(name) && (IDENTITY_WRAPPERS.has(wrapper) || BARE.has(wrapper)),
    );

    expect(
      violations,
      `Ungated staff export(s) using bare/identity wrappers outside the allowlist: ${violations
        .map((v) => `${v.name} (${v.wrapper})`)
        .join(", ")}. New staff capabilities must use queryWithMutavStaff / ` +
        `mutationWithMutavStaff / queryWithMutavRole / mutationWithMutavRole.`,
    ).toEqual([]);
  });

  test("each allowlisted export exists and uses an identity wrapper", () => {
    for (const name of ALLOWLIST) {
      const found = exports.find((e) => e.name === name);
      expect(found, `Allowlisted export "${name}" not found in useCases.ts`).toBeDefined();
      // Narrow for the type-checker without `!`; the assertion above already
      // failed the test if `found` is undefined.
      if (!found) continue;
      expect(
        IDENTITY_WRAPPERS.has(found.wrapper),
        `Allowlisted "${name}" must use queryWithAuth/mutationWithAuth, got ${found.wrapper}. ` +
          `If it became a real capability, gate it and remove it from the allowlist.`,
      ).toBe(true);
    }
  });

  test("the three known staff capabilities are detected as aud-bound", () => {
    const capabilities = ["listPendingReviews", "getDocumentDownloadUrl", "reviewOnboarding"];
    for (const name of capabilities) {
      const found = exports.find((e) => e.name === name);
      expect(found, `Capability "${name}" not found in useCases.ts`).toBeDefined();
      if (!found) continue;
      expect(
        AUD_BOUND.has(found.wrapper),
        `Capability "${name}" must be aud-bound, got ${found.wrapper}.`,
      ).toBe(true);
    }
  });
});
