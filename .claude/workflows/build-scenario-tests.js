export const meta = {
  name: 'build-scenario-tests',
  description:
    'Build convex/<domain>/scenarios.test.ts covering every applicable scenario for the given domain, then adversarially verify coverage with 3 parallel reviewers (scenario completeness, schema/index behavior, test quality). Loops back to close gaps.',
  phases: [
    { title: 'Design', detail: 'read scenarios doc + existing code, produce structured test plan' },
    { title: 'Implement', detail: 'write scenarios.test.ts, iterate until bun run test:convex passes' },
    { title: 'Verify', detail: '3 parallel adversarial reviewers with distinct lenses' },
    { title: 'Address gaps', detail: 'if any reviewer flagged missing coverage or weak tests, fix them' },
  ],
}

// Invocation:
//   Workflow({
//     name: 'build-scenario-tests',
//     args: {
//       domain: 'delinquencies',
//       scenariosDocPath: '/absolute/path/to/scenarios.md', // optional
//       contextNotes: 'Any extra background the design agent should know', // optional
//     },
//   })

if (!args || typeof args !== 'object' || !args.domain) {
  throw new Error(
    'build-scenario-tests requires args.domain (string). Optional: args.scenariosDocPath, args.contextNotes.',
  )
}

const DOMAIN = args.domain
const SCENARIOS_DOC = args.scenariosDocPath || null
const EXTRA_NOTES = args.contextNotes || ''

// We assume the workflow runs from the repo root (or a worktree of it). The
// design/implement agents will read files by absolute path, which they resolve
// using pwd. Callers who need a different repo root should include it in
// contextNotes.

const CONTEXT = `
# Context — mutav-app convex domain scenario test suite

Target domain: **${DOMAIN}** (files at convex/${DOMAIN}/**)
Test file to create: **convex/${DOMAIN}/scenarios.test.ts**
${SCENARIOS_DOC ? `Scenarios doc: ${SCENARIOS_DOC}` : 'No external scenarios doc provided — extract scenarios from the domain\'s machine.ts + schema.ts + any product docs referenced in comments.'}

## Repo conventions the tests must follow

- Runner: Vitest via \`bun run test:convex convex/${DOMAIN}/scenarios.test.ts\`
- Top-of-file directive: \`// @vitest-environment edge-runtime\` (convex-test needs it)
- Setup pattern (copy verbatim from convex/seed.test.ts):
    import { convexTest } from 'convex-test'
    import schema from '../schema'
    import { registerContractAggregateComponents } from '../lib/testFixtures'

    function setup() {
      const t = convexTest(schema)
      registerContractAggregateComponents(t) // required — aggregate writes throw otherwise
      return t
    }
- Use \`await t.run(async (ctx) => { ... })\` for db operations.
- Fixtures (agencies, users, contracts, notices) created INLINE inside t.run — do NOT depend on seedReset (too slow, too coupled).
- Money as integer cents. ISO strings for dates. No Date objects in Convex.
- Read-what-you-wrote — insert, then query back and \`toEqual\` against a literal, don't assert on side effects.
- Test hygiene per CLAUDE.md § Testing:
  * One \`describe\` per unit under test; nested only when semantic.
  * Expected values as literals in the test — never derived from the code under test.
  * Every Result-returning function gets happy-path + every distinct error \`code\` covered.
  * Pure tests <200ms/file. If you're near that, it belongs in scenarios.test.ts anyway (db-backed).
  * Never wipe \`waitlist\`, \`mutavAuditLog\`, or \`mutavStaff\` in DEMO_TABLES.

## What this test file covers vs the pure tests

- \`convex/${DOMAIN}/machine.test.ts\` — pure state machine, exhaustive matrix.
- \`convex/${DOMAIN}/domain.test.ts\` — pure value-object shape.
- **\`convex/${DOMAIN}/scenarios.test.ts\` (THIS FILE)** — db-backed scenario tests
  using convex-test that exercise the domain END-TO-END. Only tests that CAN'T
  live in the pure files (schema conformance, index queries, multi-row scenarios,
  cross-agency isolation, updates-in-place, composition of machine + db).

## Extra notes from caller

${EXTRA_NOTES || '(none)'}

## Non-goals — call out any drift

- Do NOT test other domains (sister branches / not built)
- Do NOT test mutations that don't exist yet — simulate them at the db layer with \`ctx.db.insert\` / \`ctx.db.patch\`
- Do NOT duplicate the pure machine's transition matrix
`

phase('Design')

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tests', 'file_path', 'imports', 'coverage_summary'],
  properties: {
    file_path: { type: 'string', description: 'Absolute path where the test file will be written.' },
    imports: {
      type: 'array',
      items: { type: 'string' },
      description: 'Complete list of import statements the test file needs.',
    },
    tests: {
      type: 'array',
      description: 'Every test in the file. Order matches file order.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'describe_block',
          'test_name',
          'scenario_source',
          'arrange',
          'act',
          'assert',
          'coverage_claim',
        ],
        properties: {
          describe_block: { type: 'string', description: 'Which describe block this test lives in.' },
          test_name: { type: 'string', description: 'The exact test name (verb-first, scenario-descriptive).' },
          scenario_source: {
            type: 'string',
            description:
              'Which row of the scenarios doc, or which schema feature, or which value-object variant this test covers. Use "N/A — schema/infra" for pure schema-conformance tests.',
          },
          arrange: { type: 'string', description: '2-3 sentences: what data gets set up.' },
          act: { type: 'string', description: '1-2 sentences: what operation gets performed.' },
          assert: { type: 'string', description: '1-3 sentences: exact assertions.' },
          coverage_claim: {
            type: 'string',
            description: "One sentence: what this test proves that other tests don't.",
          },
        },
      },
    },
    coverage_summary: {
      type: 'object',
      additionalProperties: false,
      required: [
        'scenarios_covered',
        'schema_features_covered',
        'index_coverage',
        'total_test_count',
      ],
      properties: {
        scenarios_covered: {
          type: 'array',
          items: { type: 'string' },
          description: 'Human-readable list of scenarios from the doc (or product intent) that get exercised.',
        },
        schema_features_covered: {
          type: 'array',
          items: { type: 'string' },
          description: 'e.g. "optional resolution field", "updatedAmountCents mutability".',
        },
        index_coverage: {
          type: 'array',
          items: { type: 'string' },
          description: 'Which schema indexes each get exercised via .withIndex(...).',
        },
        total_test_count: { type: 'number' },
      },
    },
  },
}

const design = await agent(
  `${CONTEXT}

# Your task — design the scenarios test suite

Read these before designing:
- convex/${DOMAIN}/machine.ts (exact export shape)
- convex/${DOMAIN}/domain.ts (value objects + validators + Doc<>/Id<> aliases)
- convex/${DOMAIN}/machine.test.ts (existing test shape to match)
- convex/${DOMAIN}/domain.test.ts
- convex/seed.test.ts (canonical convex-test example in this repo — copy the setup() pattern including registerContractAggregateComponents)
- convex/lib/testFixtures.ts (available helpers)
- convex/schema.ts (search for the domain's table def, understand every field + index)
- convex/seed.ts (how the domain's rows are seeded — copy the insert shape)
${SCENARIOS_DOC ? `- ${SCENARIOS_DOC} (READ IN FULL — this is the source of truth for the scenario matrix)` : ''}

Produce a structured test plan via the StructuredOutput schema. Every test must:
1. Exercise something the pure tests don't cover.
2. Be db-backed (uses convexTest + t.run).
3. Have a specific coverage claim.

Prefer many tight tests over few broad tests. Order simplest → composite so the reader can skim describe blocks and see the story.

## Non-goals

- No tests for other domains (sister branches / not built)
- No tests for mutation wrappers that don't exist yet
- No tests that duplicate the pure machine matrix

## Output

Structured plan via schema. Every test that will land in the file — the next phase writes them verbatim.`,
  { label: 'design', phase: 'Design', schema: DESIGN_SCHEMA },
)

phase('Implement')

const impl = await agent(
  `${CONTEXT}

# Your task — implement the scenarios test file

The design phase produced this plan:

\`\`\`json
${JSON.stringify(design, null, 2)}
\`\`\`

Write the file at ${design.file_path} following the plan EXACTLY:
- Same imports listed
- Same describe blocks in same order
- Same test names verbatim
- Each test's arrange/act/assert matches the plan

Additional constraints (already in the design agent's context — repeated here so you don't need to hunt):

- Top of file: \`// @vitest-environment edge-runtime\`
- Setup: convexTest(schema) + registerContractAggregateComponents(t) — see convex/seed.test.ts
- Fixtures created INLINE inside t.run — no seedReset dependency
- Integer cents, ISO strings, no Date objects
- Read-what-you-wrote assertions with \`.toEqual([literal])\`

After writing, run from the repo root:
\`\`\`
bun run test:convex convex/${DOMAIN}/scenarios.test.ts
\`\`\`

If tests fail: fix the code (never the assertion) and re-run. Iterate up to 5 times. If tests still fail after 5, return the failure output verbatim and stop — do not commit broken code.

Once all tests pass, return:
1. The final file path
2. The passing test count
3. Any deviations from the plan (with justification)
4. \`git diff --stat\` output for the file`,
  { label: 'implement', phase: 'Implement' },
)

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['missing_scenarios', 'weak_tests', 'verdict'],
  properties: {
    missing_scenarios: {
      type: 'array',
      description: "Scenarios that the test file does NOT cover but should.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['scenario', 'why_it_matters', 'proposed_test_name'],
        properties: {
          scenario: { type: 'string' },
          why_it_matters: { type: 'string' },
          proposed_test_name: { type: 'string' },
        },
      },
    },
    weak_tests: {
      type: 'array',
      description: "Tests present in the file that don't actually prove what they claim.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['test_name', 'weakness', 'proposed_fix'],
        properties: {
          test_name: { type: 'string' },
          weakness: { type: 'string' },
          proposed_fix: { type: 'string' },
        },
      },
    },
    verdict: {
      type: 'string',
      enum: ['adequate', 'has_gaps', 'critical_gaps'],
      description: 'adequate = ship it. has_gaps = fix in this workflow. critical_gaps = block.',
    },
  },
}

const verifiers = await parallel([
  () =>
    agent(
      `${CONTEXT}

# Your task — adversarial coverage review (lens: SCENARIO COMPLETENESS)

Read convex/${DOMAIN}/scenarios.test.ts in full. ${SCENARIOS_DOC ? `Also re-read ${SCENARIOS_DOC}.` : 'Also re-read convex/' + DOMAIN + '/machine.ts + domain.ts to enumerate every state + variant that should be scenario-tested.'}

Your lens: **scenario completeness**. Every domain-level scenario must correspond to at least one test. Bias: default to "missing" if uncertain — the address-gaps phase can prune false positives.

Focus areas:
- Every scenario in the doc (if one exists) that plausibly touches this domain
- Every value-object variant (resolution kinds, cancellation reasons, evidence sources, etc.)
- Cross-agency isolation
- Multi-row per parent (e.g., multiple notices per contract)
- Composition of the machine's transitions with real db mutations

Return via schema. Empty array = perfect coverage.`,
      { label: 'verify-scenarios', phase: 'Verify', schema: VERIFY_SCHEMA },
    ),

  () =>
    agent(
      `${CONTEXT}

# Your task — adversarial coverage review (lens: SCHEMA & INDEX BEHAVIOR)

Read convex/${DOMAIN}/scenarios.test.ts in full. Also re-read convex/schema.ts (this domain's table only).

Your lens: **schema and index behavior**. Every schema feature and every index must be exercised. Bias: if an index is defined but no test uses \`.withIndex("by_...")\`, flag it.

Focus areas:
- Each defined index — used somewhere?
- Optional fields — both present-and-absent variants tested?
- Nested optional fields (e.g. optional field on an optional object)
- Field mutability where relevant (patch + read back)
- Cross-agency isolation via agency-scoped indexes
- \`schemaValidation: false\` in this repo, so schema-conformance tests must explicitly compare inserted fields to the schema shape.

Also flag tests that appear to test the pure machine (belongs in machine.test.ts) or pure predicates (belongs in domain.test.ts) rather than the db layer.

Return via schema. Empty array = perfect coverage.`,
      { label: 'verify-schema', phase: 'Verify', schema: VERIFY_SCHEMA },
    ),

  () =>
    agent(
      `${CONTEXT}

# Your task — adversarial coverage review (lens: TEST QUALITY)

Read convex/${DOMAIN}/scenarios.test.ts in full.

Your lens: **test quality**. Each test must actually prove what its name claims. Bias: skeptical. Bad tests are worse than missing tests because they give false confidence.

Look for:
- Tests that would pass with an empty implementation (implementation-free assertions)
- Tests where the arrange step already contains the answer being asserted
- \`.toContain(...)\` on a set of size 1 (should be \`.toEqual([...])\`)
- Tests that assert on the arrange step rather than the effect of the act step
- \`try/catch\` swallowing negative-path errors — should use \`expect(...).toThrow()\` or Result-based checks
- Tests that leak state between each other (convex-test gives a fresh state per setup() call — verify each test calls setup())
- Assertions on \`_creationTime\` or specific Id values (unstable)
- Missing negative-path coverage: for every "X succeeds when valid" there should be "X rejected when invalid"

Return via schema. Empty array = high quality.`,
      { label: 'verify-quality', phase: 'Verify', schema: VERIFY_SCHEMA },
    ),
])

// Merge findings from the 3 verifiers
const allMissing = verifiers.filter(Boolean).flatMap((v) => v.missing_scenarios || [])
const allWeak = verifiers.filter(Boolean).flatMap((v) => v.weak_tests || [])
const worstVerdict = verifiers.filter(Boolean).reduce((worst, v) => {
  const order = { adequate: 0, has_gaps: 1, critical_gaps: 2 }
  return order[v.verdict] > order[worst] ? v.verdict : worst
}, 'adequate')

log(
  `Verify phase complete. verdict=${worstVerdict}, missing=${allMissing.length}, weak=${allWeak.length}`,
)

let finalReport = null

if (allMissing.length === 0 && allWeak.length === 0) {
  finalReport = {
    verdict: 'adequate',
    message: 'No gaps found. Test suite is complete.',
    impl,
    verifiers,
  }
} else {
  phase('Address gaps')

  const addressed = await agent(
    `${CONTEXT}

# Your task — address the coverage gaps

Three adversarial reviewers examined convex/${DOMAIN}/scenarios.test.ts. They surfaced:

## Missing scenarios (${allMissing.length})
${JSON.stringify(allMissing, null, 2)}

## Weak tests (${allWeak.length})
${JSON.stringify(allWeak, null, 2)}

## Overall verdict: ${worstVerdict}

Address every item:
- For each missing scenario: add a new test using the proposed name.
- For each weak test: apply the proposed fix (rewrite it, don't delete).
- If a reviewer flag is wrong (duplicate of existing test, out of scope, misreads the file), IGNORE it — but call out which flags you ignored and why.

After editing, run from repo root:
\`\`\`
bun run test:convex convex/${DOMAIN}/scenarios.test.ts
\`\`\`

Iterate up to 5 times until all tests pass. Return:
1. Final passing test count
2. Which reviewer flags you addressed
3. Which reviewer flags you ignored (with justification)
4. \`git diff --stat convex/${DOMAIN}/scenarios.test.ts\` output`,
    { label: 'address-gaps', phase: 'Address gaps' },
  )

  finalReport = { verdict: worstVerdict, missing: allMissing, weak: allWeak, addressed, impl, verifiers }
}

return finalReport
