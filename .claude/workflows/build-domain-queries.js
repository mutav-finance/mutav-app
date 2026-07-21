export const meta = {
  name: 'build-domain-queries',
  description:
    'Build convex/<domain>/useCases.ts (the query surface) with adversarial verification of wrapper choice, index efficiency, and return-shape stability, then generate useCases.test.ts covering wrapper enforcement, pagination, and cross-agency isolation.',
  phases: [
    { title: 'Design', detail: 'signatures + return shapes + index picks per function' },
    { title: 'Implement', detail: 'write useCases.ts + iterate until typecheck + existing tests pass' },
    { title: 'Verify', detail: '3 parallel adversarial reviewers (wrapper contract, index efficiency, return-shape stability)' },
    { title: 'Address gaps', detail: 'fix any critical/major findings' },
    { title: 'Tests', detail: 'write useCases.test.ts covering wrappers + pagination + null-on-miss + staff-role gating' },
  ],
}

// Invocation:
//   Workflow({
//     name: 'build-domain-queries',
//     args: {
//       domain: 'guarantees',                                        // required — convex/<domain>/
//       contextNotes: 'Any extra background: what queries to build, wrapper hints, index intents',  // strongly recommended
//     },
//   })
//
// This workflow is opinionated: it produces convex/<domain>/useCases.ts +
// convex/<domain>/useCases.test.ts, uses only pre-existing auth wrappers
// (queryWithAgencyScope, queryWithMutavRole, bare query + assertAgencyAccess,
// internalQuery), and requires `bun run test:convex convex/<domain>/` to be
// all-green before returning.

if (!args || typeof args !== 'object' || !args.domain) {
  throw new Error(
    'build-domain-queries requires args.domain (string). Optional: args.contextNotes.',
  )
}

const DOMAIN = args.domain
const EXTRA_NOTES = args.contextNotes || ''

const CONTEXT = `
# Context — mutav-app convex domain query surface

Target domain: **${DOMAIN}** (files at convex/${DOMAIN}/**)
Target file: **convex/${DOMAIN}/useCases.ts**
Target test file: **convex/${DOMAIN}/useCases.test.ts**

## Auth wrappers — use ONLY these (from convex/lib/auth.ts)

- queryWithAgencyScope — agency-owned reads. Consumes agencyId from args (stripped before handler). Injects ctx.user, ctx.membership, ctx.agencyId.
- queryWithMutavRole({ minRole: 'compliance' }) — role-gated staff reads. Ladder: support < compliance < admin (treasury off-ladder, never satisfies operational gate). Injects ctx.user, ctx.mutavStaffRoles.
- Bare \`query\` + assertAgencyAccess(ctx, resource.agencyId) — for resource-by-id reads where agencyId comes from the fetched row (NOT from args). MUST try/catch and return null on ForbiddenError/UnauthenticatedError so cross-agency existence cannot be probed.
- internalQuery — private companion, only callable from other Convex functions.

DO NOT invent a new custom wrapper — these cover every case.

## Convex guidelines (authoritative — from convex/_generated/ai/guidelines.md)

- Always include argument validators. paginationOptsValidator from convex/server for paginated lists.
- Never .filter() — use .withIndex().
- Never .collect().length — use aggregates or bounded .take(N).
- Return bounded collections: .paginate() for lists, .take(N) / .unique() for scalars.
- No @/... alias inside convex/ (Convex module resolver); relative imports only.
- Never accept userId/subject/tokenIdentifier from client args — derive from ctx.user.

## Repo test convention

- convex/<domain>/machine.test.ts — pure state machine matrix (exists on this branch if the domain has a machine).
- convex/<domain>/domain.test.ts — pure value objects.
- convex/<domain>/scenarios.test.ts — db-backed schema/index/lifecycle tests.
- **convex/<domain>/useCases.test.ts (THIS WORKFLOW)** — query-surface tests: wrapper enforcement, pagination, staff-role gating, null-on-miss.

Runner: \`bun run test:convex convex/<domain>/\` (root vitest.config.ts + server.deps.inline convex-test + resolve.preserveSymlinks).

## Non-goals — flag if design drifts

- No new custom wrapper.
- No mutations (separate workflow: build-domain-mutations).
- No UI wiring.
- No aggregate-component setup (defer with TODO).

## Extra notes from caller

${EXTRA_NOTES || '(none)'}
`

phase('Design')

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['functions', 'imports', 'design_notes'],
  properties: {
    imports: { type: 'array', items: { type: 'string' } },
    functions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'wrapper', 'args_signature', 'return_shape', 'index_used', 'implementation_sketch', 'rationale'],
        properties: {
          name: { type: 'string' },
          wrapper: { type: 'string' },
          args_signature: { type: 'string' },
          return_shape: { type: 'string' },
          index_used: { type: 'string' },
          implementation_sketch: { type: 'string', description: '5-15 lines of pseudo-TS showing the handler body' },
          rationale: { type: 'string' },
        },
      },
    },
    design_notes: { type: 'array', items: { type: 'string' } },
  },
}

const design = await agent(`${CONTEXT}

# Your task — design the query surface

Read before designing:
- convex/lib/auth.ts (all wrapper signatures)
- convex/invoices/useCases.ts (canonical local pattern for queries)
- convex/contracts/useCases.ts (skim: getByPublicId + getStatusCounts + getByPublicIdInternal shapes)
- convex/${DOMAIN}/machine.ts (if exists) + convex/${DOMAIN}/domain.ts (exact exports + validators)
- convex/${DOMAIN}/scenarios.test.ts (if exists — informs what the queries should return)
- convex/_generated/ai/guidelines.md

Produce a structured design via the schema. For each function specify wrapper, args, return type, index, and 5-15 lines of pseudo-TS.

Non-goals: new wrapper, mutations, UI, aggregate components.`, { label: 'design', phase: 'Design', schema: DESIGN_SCHEMA })

phase('Implement')

const impl = await agent(`${CONTEXT}

# Your task — implement convex/${DOMAIN}/useCases.ts

Design plan:

\`\`\`json
${JSON.stringify(design, null, 2)}
\`\`\`

Follow it EXACTLY: same imports, same functions in the same order, same wrapper choices, same validators, same return shapes, same indexes.

## Coding rules

- Relative imports (never @/... inside convex/).
- Every function has a JSDoc <=3 lines explaining WHY.
- No .filter() in db queries.
- Never .collect() unless the design says to.
- Try/catch around assertAgencyAccess in resource-by-id reads — return null on ForbiddenError/UnauthenticatedError.
- Guard clauses over nesting; object params over long arg lists; no boolean flag args.
- English-only identifiers (repo rule — CLAUDE.md § Code style).
- Return type annotations on every handler (avoid inferred Doc<> leaking envelope fields).

## Verification loop

\`\`\`
bun run typecheck
bun run test:convex convex/${DOMAIN}/
\`\`\`

Iterate up to 5 times. Fix the code (never weaken the design). Existing tests MUST still pass.

Return:
1. Final file path + line count
2. bun run typecheck result
3. bun run test:convex convex/${DOMAIN}/ result (no regressions)
4. Any deviations from the plan (with justification)
5. git diff --stat`, { label: 'implement', phase: 'Implement' })

phase('Verify')

const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings', 'verdict'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['function_name', 'issue', 'severity', 'proposed_fix'],
        properties: {
          function_name: { type: 'string' },
          issue: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          proposed_fix: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string', enum: ['adequate', 'has_gaps', 'critical_gaps'] },
  },
}

const verifiers = await parallel([
  () => agent(`${CONTEXT}

# Your task — adversarial review (lens: WRAPPER CONTRACT CORRECTNESS)

Read convex/${DOMAIN}/useCases.ts in full. Also re-read convex/lib/auth.ts + docs/auth.md if it exists.

Flag:
- Agency-scoped handler using bare query without assertAgencyAccess
- queryWithAgencyScope that ALSO declares agencyId in handler args (double declaration)
- queryWithMutavRole with wrong minRole
- Resource-by-id read that throws instead of returning null on Forbidden (leaks cross-agency existence)
- internalQuery accidentally exposed as query
- Handler manually reading ctx.auth.getUserIdentity() when a wrapper would do it
- Missing argument validators

Return via schema. Empty findings = pass.`, { label: 'verify-wrappers', phase: 'Verify', schema: VERIFY_SCHEMA }),

  () => agent(`${CONTEXT}

# Your task — adversarial review (lens: INDEX EFFICIENCY & QUERY SAFETY)

Read convex/${DOMAIN}/useCases.ts in full. Also re-read convex/schema.ts (this domain's table + indexes).

Flag:
- Any .filter() on db.query (full-table scan)
- Any .collect() without a hard bound
- Any .collect().length (banned)
- .paginate() called without paginationOptsValidator in args
- .withIndex() with wrong field order
- Listing handler without a status/kind filter when the index would require it
- .take(N) with N large enough to blow the row-count budget at pilot scale (>5000)

Return via schema. Empty findings = pass.`, { label: 'verify-indexes', phase: 'Verify', schema: VERIFY_SCHEMA }),

  () => agent(`${CONTEXT}

# Your task — adversarial review (lens: RETURN-SHAPE STABILITY & CALLER ERGONOMICS)

Read convex/${DOMAIN}/useCases.ts in full. Also skim any consumer UI files if they exist for this domain.

Flag:
- Leaked _creationTime or envelope fields the UI shouldn't depend on
- Raw Doc<> exposed when a projected row would be safer
- Paginated handler that doesn't return the standard { page, isDone, continueCursor }
- Stats/count handler that returns bare numbers without a wrapping object
- Resource-by-id read that returns undefined instead of null (Convex convention is null for absence)
- Missing return-type annotations on handlers (breaks IDE inference for callers using api.<domain>.useCases.X)

Return via schema. Empty findings = pass.`, { label: 'verify-shapes', phase: 'Verify', schema: VERIFY_SCHEMA }),
])

const allFindings = verifiers.filter(Boolean).flatMap((v) => v.findings || [])
const critical = allFindings.filter((f) => f.severity === 'critical')
const major = allFindings.filter((f) => f.severity === 'major')
const minor = allFindings.filter((f) => f.severity === 'minor')
const worstVerdict = verifiers.filter(Boolean).reduce((worst, v) => {
  const order = { adequate: 0, has_gaps: 1, critical_gaps: 2 }
  return order[v.verdict] > order[worst] ? v.verdict : worst
}, 'adequate')

log(`Verify: verdict=${worstVerdict}, critical=${critical.length}, major=${major.length}, minor=${minor.length}`)

let addressGaps = null
if (allFindings.length > 0) {
  phase('Address gaps')
  addressGaps = await agent(`${CONTEXT}

# Your task — address ${allFindings.length} review findings

\`\`\`json
${JSON.stringify(allFindings, null, 2)}
\`\`\`

Address every critical and major. Minor: apply unless conflicting with the design. Ignore wrong findings — call out which and why.

Re-run:

\`\`\`
bun run typecheck
bun run test:convex convex/${DOMAIN}/
\`\`\`

Iterate up to 3 times. Report: which findings addressed, which ignored (with justification), final typecheck + test results, git diff --stat.`, { label: 'address-gaps', phase: 'Address gaps' })
}

phase('Tests')

const tests = await agent(`${CONTEXT}

# Your task — write convex/${DOMAIN}/useCases.test.ts

Distinct from scenarios.test.ts (schema/index/lifecycle at db-ctx). This covers the QUERY SURFACE: wrapper enforcement, pagination, staff-role gating, null-on-miss, cross-agency isolation.

## Setup (copy verbatim from convex/seed.test.ts)

Top of file: \`// @vitest-environment edge-runtime\`
Body:

    import { convexTest } from 'convex-test'
    import schema from '../schema'
    import { registerContractAggregateComponents } from '../lib/testFixtures'

    function setup() {
      const t = convexTest(schema)
      registerContractAggregateComponents(t)
      return t
    }

## Non-obvious infra

- t.withIdentity({ subject }) scopes ctx.auth.getUserIdentity() to that subject. Auth wrappers look up users by users.by_subject — the fixture MUST seed a users row with matching subject.
- Staff-role gating: insert a mutavStaff row { userId, role, createdAt } for the same userId. The aud claim is unused (Convex doesn't surface it); mutavStaff is the sole gate.
- queryWithMutavRole({ minRole }) throws ForbiddenError with a message containing the requested rung — so \`.rejects.toThrow(/compliance/)\` is stable for both "insufficient rung" and "off-ladder" cases.

## Coverage matrix

For each public function, cover:

- **Auth failures** — unauthenticated (throws or null-on-miss per handler design), wrong agency, no staff row, insufficient staff role, off-ladder staff role.
- **Happy path** — returns expected shape with fixture data.
- **Cross-agency isolation** — agency A cannot see agency B's data (via wrapper).
- **For paginated handlers** — { page, isDone, continueCursor } shape; numItems bound respected.
- **For resource-by-id** — non-existent id returns null.
- **For stats** — expected counts match fixture data.
- **For internalQuery** — callable via \`t.query(internal.<domain>.useCases.<fn>, {...})\` returns the raw doc or null.

## Rules

- Each test calls setup() for a fresh instance (no state leaks).
- Fixtures inline inside t.run: agency, user, membership, target row.
- Read-what-you-wrote assertions via .toEqual against literals.
- For pagination shape, verify all 3 fields.
- For role tests, use \`.rejects.toThrow(/pattern/)\` or \`.rejects.toBeInstanceOf(ForbiddenError)\`.

## Verification

\`\`\`
bun run test:convex convex/${DOMAIN}/useCases.test.ts
bun run test:convex convex/${DOMAIN}/
\`\`\`

Iterate up to 5 times. Report:
1. Passing test count for useCases.test.ts alone
2. Total domain count
3. Any deferred tests (with TODO reason)
4. git diff --stat`, { label: 'tests', phase: 'Tests' })

return {
  design,
  impl,
  verifiers: { wrappers: verifiers[0], indexes: verifiers[1], shapes: verifiers[2] },
  verdict: worstVerdict,
  findings_count: { critical: critical.length, major: major.length, minor: minor.length },
  address_gaps: addressGaps,
  tests,
}
