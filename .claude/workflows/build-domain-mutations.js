export const meta = {
  name: 'build-domain-mutations',
  description:
    'Build convex/<domain>/mutations.ts (the write surface) with adversarial verification of wrapper choice, machine composition (assertTransition-before-patch), and audit emission, then generate mutations.test.ts covering happy paths + illegal transitions + auth failures + cross-agency isolation.',
  phases: [
    { title: 'Design', detail: 'signatures + Result shapes + machine composition sketch + wrapper choice + audit strategy' },
    { title: 'Implement', detail: 'write mutations.ts + iterate until typecheck + existing tests pass' },
    { title: 'Verify', detail: '3 parallel adversarial reviewers (wrapper contract, machine composition, audit + write safety)' },
    { title: 'Address gaps', detail: 'fix any critical/major findings' },
    { title: 'Tests', detail: 'write mutations.test.ts covering happy paths + illegal transitions + auth failures + cross-agency isolation + audit emission' },
  ],
}

// Invocation:
//   Workflow({
//     name: 'build-domain-mutations',
//     args: {
//       domain: 'guarantees',                                                       // required
//       contextNotes: 'The mutations to build, machine-composition points, audit expectations', // strongly recommended
//     },
//   })
//
// Opinionated: produces convex/<domain>/mutations.ts + convex/<domain>/mutations.test.ts,
// uses only pre-existing auth wrappers (mutationWithAgencyScope, mutationWithMutavRole,
// bare mutation + assertAgencyAccess, internalMutation), requires the Result pattern
// from convex/lib/result.ts, and requires every status-changing patch to be guarded
// by assertTransition on the domain's machine.

// The Workflow tool may deliver `args` as a JSON string (named-workflow
// invocation) or as an object (dynamic-script invocation). Normalize.
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
if (!parsedArgs || typeof parsedArgs !== 'object' || !parsedArgs.domain) {
  throw new Error(
    'build-domain-mutations requires args.domain (string). Optional: args.contextNotes.',
  )
}

const DOMAIN = parsedArgs.domain
const EXTRA_NOTES = parsedArgs.contextNotes || ''

const CONTEXT = `
# Context — mutav-app convex domain mutation surface

Target domain: **${DOMAIN}** (files at convex/${DOMAIN}/**)
Target file: **convex/${DOMAIN}/mutations.ts**
Target test file: **convex/${DOMAIN}/mutations.test.ts**

## Auth wrappers — use ONLY these (from convex/lib/auth.ts)

- mutationWithAgencyScope — agency-owned writes. Consumes agencyId from args (stripped before handler). Injects ctx.user, ctx.membership, ctx.agencyId.
- mutationWithMutavRole({ minRole: 'compliance' }) — role-gated staff writes. Ladder: support < compliance < admin (treasury off-ladder, never satisfies operational gate). Injects ctx.user, ctx.mutavStaffRoles, ctx.appendStaffAudit (hash-chained audit append with actor pre-bound to the staff user).
- Bare mutation + assertAgencyAccess(ctx, resource.agencyId) — for resource-by-id writes where agencyId comes from the fetched row. Writes let the throw propagate (unlike reads which return null).
- internalMutation — private companion.

DO NOT invent a new custom wrapper.

## Result pattern (from convex/lib/result.ts)

Domain mutations return Result<TSuccess, TError> instead of throwing. Always plain object literals — no helper wrappers. Example:

    type OpenSuccess = { publicId: string; noticeId: DelinquencyNoticeId }
    type OpenError = { code: 'CONTRACT_NOT_FOUND' | 'CONTRACT_NOT_ACTIVE' | 'DUPLICATE' }

    export const openNotice = mutationWithAgencyScope({
      args: { ... },
      handler: async (ctx, args): Promise<Result<OpenSuccess, OpenError>> => {
        if (!contract) return { success: false, error: { code: 'CONTRACT_NOT_FOUND' }, message: '...' }
        return { success: true, data: { publicId, noticeId }, message: 'Notice opened.' }
      },
    })

## Machine composition — the critical pattern

Every state transition MUST:
1. Read the target row.
2. Call assertTransition(from, to) FIRST (from convex/<domain>/machine.ts).
3. If Result.success = false, return a Result error (never patch).
4. If success, do ctx.db.patch(id, { status: to, ...envelope }).
5. For staff-touched transitions, emit an audit entry via ctx.appendStaffAudit(...).

The pattern is documented in convex/<domain>/scenarios.test.ts's "composition" describe block if the domain has one. Follow it.

## Timestamp derivation

Every timestamp field (openedAt, resolvedAt, canceledAt, etc.) MUST be derived server-side inside the handler, never accepted from client args. Convex mutations run in a deterministic sandbox; use the platform's built-in current-time primitive.

## Convex guidelines (authoritative — from convex/_generated/ai/guidelines.md)

- Always include argument validators.
- Never .filter() — use indexes.
- Never .collect() unless bounded.
- Idempotency: check for duplicates BEFORE inserting.
- Never accept userId/subject/tokenIdentifier from client args — derive from ctx.user.

## Audit emission

- Staff mutations MUST call ctx.appendStaffAudit(...) (provided by mutationWithMutavRole). AUDIT_ACTION literals are in convex/audit/domain.ts — add new ones there if needed.
- Agency mutations: no audit helper on mutationWithAgencyScope by default. Design phase decides: skip for pilot, OR call appendAuditEntry directly from convex/audit/useCases.ts with actor: { kind: 'user', userId: ctx.user._id }.

## Repo test convention

- convex/<domain>/machine.test.ts — pure state machine matrix (exists on this branch if the domain has a machine).
- convex/<domain>/domain.test.ts — pure value objects.
- convex/<domain>/scenarios.test.ts — db-backed schema/index/lifecycle tests.
- convex/<domain>/useCases.test.ts — query-surface tests (from build-domain-queries workflow).
- **convex/<domain>/mutations.test.ts (THIS WORKFLOW)** — write-surface tests: happy paths + illegal transitions + auth failures + audit emission.

Runner: \`bun run test:convex convex/<domain>/\`.

## Non-goals — flag if design drifts

- No new custom wrapper.
- No queries (separate workflow: build-domain-queries).
- No UI wiring.
- No cross-domain writes (a mutation on <domain> that patches a different domain's table is a design smell — call it out).

## Extra notes from caller

${EXTRA_NOTES || '(none)'}
`

phase('Design')

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['mutations', 'imports', 'audit_strategy', 'design_notes'],
  properties: {
    imports: { type: 'array', items: { type: 'string' } },
    mutations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'wrapper', 'args_signature', 'return_shape', 'validations', 'writes', 'audit_emit', 'implementation_sketch', 'rationale'],
        properties: {
          name: { type: 'string' },
          wrapper: { type: 'string' },
          args_signature: { type: 'string', description: 'TS-shaped args object with validators' },
          return_shape: { type: 'string', description: 'Result<TSuccess, TError> — spell out both' },
          validations: { type: 'array', items: { type: 'string' }, description: 'Ordered preconditions checked before any write' },
          writes: { type: 'array', items: { type: 'string' }, description: 'Ordered list of db.insert / db.patch calls' },
          audit_emit: { type: 'string', description: 'Which appendStaffAudit / appendAuditEntry call, or "none — pilot deferral"' },
          implementation_sketch: { type: 'string', description: '15-30 lines of pseudo-TS showing the handler body' },
          rationale: { type: 'string' },
        },
      },
    },
    audit_strategy: { type: 'string', description: 'How agency-side vs staff-side audit works. Decision + justification.' },
    design_notes: { type: 'array', items: { type: 'string' } },
  },
}

const design = await agent(`${CONTEXT}

# Your task — design the mutation surface

Read before designing:
- convex/lib/auth.ts (all wrappers, especially mutationWithAgencyScope + mutationWithMutavRole)
- convex/lib/result.ts (Result pattern)
- convex/${DOMAIN}/machine.ts (if exists — assertTransition + error codes)
- convex/${DOMAIN}/domain.ts (validators + value objects)
- convex/${DOMAIN}/useCases.ts (query surface — patterns for lookups you'll reuse)
- convex/${DOMAIN}/scenarios.test.ts (if exists — "composition" describe block documents the guardedPatch pattern)
- convex/audit/domain.ts (AUDIT_ACTION literals, auditActorValidator)
- convex/audit/useCases.ts (appendAuditEntry)
- convex/_generated/ai/guidelines.md
- convex/contracts/useCases.ts (grep for mutationWithAgencyScope for a clean example)
- convex/mutavStaff/useCases.ts if it exists (mutationWithMutavRole pattern)

Produce a structured design via the schema. Finalize:
- Exact mutation count + name per mutation
- Wrapper choice per mutation (agency vs staff-role-gated vs bare + assertAgencyAccess)
- Args validators (use domain validators where possible)
- Result success + error shapes with every distinct error code
- Validation order (auth is done by wrapper; then domain preconditions)
- Machine composition point — assertTransition MUST guard the patch
- Audit emission strategy — reconcile agency-side vs staff-side

Non-goals — flag drift toward: new custom wrapper, queries, UI, cross-domain writes.`, { label: 'design', phase: 'Design', schema: DESIGN_SCHEMA })

phase('Implement')

const impl = await agent(`${CONTEXT}

# Your task — implement convex/${DOMAIN}/mutations.ts

Design plan:

\`\`\`json
${JSON.stringify(design, null, 2)}
\`\`\`

Follow it EXACTLY: same imports, same mutations in the same order, same wrapper choices, same args validators, same Result shapes, same validation order, same audit emission.

## Coding rules

- Relative imports (never @/... inside convex/).
- Every mutation has a JSDoc <=3 lines explaining WHY.
- No .filter() in db queries.
- Never .collect() unless the design says to.
- Result pattern per convex/lib/result.ts — plain object literals.
- Machine's assertTransition MUST be called before every ctx.db.patch that changes status.
- Every timestamp field derived server-side inside the handler.
- Guard clauses over nesting; object params over long arg lists; no boolean flag args.
- English-only identifiers.

## Verification loop

\`\`\`
bun run typecheck
bun run test:convex convex/${DOMAIN}/
\`\`\`

Iterate up to 5 times. Fix the code (never weaken the design). Existing tests MUST still pass — no regressions.

Return:
1. Final file path + line count
2. bun run typecheck result
3. bun run test:convex convex/${DOMAIN}/ result (no regressions, or explicitly document why the count changed)
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
        required: ['mutation_name', 'issue', 'severity', 'proposed_fix'],
        properties: {
          mutation_name: { type: 'string' },
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

Read convex/${DOMAIN}/mutations.ts in full. Also re-read convex/lib/auth.ts.

Flag:
- Agency-scoped write via bare mutation without assertAgencyAccess
- mutationWithAgencyScope that ALSO declares agencyId in handler args
- mutationWithMutavRole with wrong minRole
- internalMutation accidentally exposed as mutation
- Handler manually reading ctx.auth.getUserIdentity() when a wrapper would do it
- Handler accepting userId/subject/tokenIdentifier from client args (banned)
- Agency-scoped mutation accepting a staff-only enum value (e.g. staff_dismissed as a cancellation reason)
- Staff-only mutation accepting an agency-only enum value
- Missing argument validators

Return via schema. Empty findings = pass.`, { label: 'verify-wrappers', phase: 'Verify', schema: VERIFY_SCHEMA }),

  () => agent(`${CONTEXT}

# Your task — adversarial review (lens: MACHINE COMPOSITION & TRANSITION SAFETY)

Read convex/${DOMAIN}/mutations.ts in full. Also re-read convex/${DOMAIN}/machine.ts and the "composition" describe block in convex/${DOMAIN}/scenarios.test.ts if it exists.

Flag:
- ctx.db.patch that changes status without a preceding assertTransition call
- assertTransition called but the mutation proceeds even if success === false
- Mutation that returns a domain error but silently patched the row
- Wrong error code returned (SELF_TRANSITION where ILLEGAL_TRANSITION was expected, etc.)
- Missing terminal-state protection: a mutation that tries to move away from a terminal state
- Idempotency hole: an insert with a duplicate natural-key that inserts anyway
- Missing required envelope on a state change (e.g. resolution without resolvedAt / resolvedByUserId / kind)

Return via schema. Empty findings = pass.`, { label: 'verify-machine', phase: 'Verify', schema: VERIFY_SCHEMA }),

  () => agent(`${CONTEXT}

# Your task — adversarial review (lens: AUDIT EMISSION & WRITE SAFETY)

Read convex/${DOMAIN}/mutations.ts in full. Also re-read convex/audit/domain.ts + convex/audit/useCases.ts.

Flag:
- Staff mutation that patches without calling ctx.appendStaffAudit (or equivalent)
- Audit call with wrong AUDIT_ACTION literal or missing required fields
- Audit called BEFORE the write (should be after so the row exists)
- Multiple writes in a single mutation without an idempotency key
- A write that would leave the row in a partially-transitioned state if a subsequent write failed
- Return value that leaks internal ids the caller shouldn't see
- Result error that swallows the underlying cause (should preserve the code from assertTransition)
- Timestamp derived from client args instead of server-side

For every staff mutation: verify a corresponding AUDIT_ACTION literal exists in convex/audit/domain.ts (or a new one was added). Flag missing literals.

Return via schema. Empty findings = pass.`, { label: 'verify-audit', phase: 'Verify', schema: VERIFY_SCHEMA }),
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

# Your task — write convex/${DOMAIN}/mutations.test.ts

Distinct from scenarios.test.ts (schema/index/lifecycle at db-ctx) and useCases.test.ts (query wrappers). This covers the MUTATION SURFACE: happy paths + illegal transitions + auth failures + cross-agency isolation + audit emission.

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

- t.withIdentity({ subject }) scopes ctx.auth.getUserIdentity() to that subject. Auth wrappers look up users.by_subject — fixture MUST seed a users row with matching subject.
- Staff-role gating: insert a mutavStaff row { userId, role, createdAt } for the same userId.
- mutationWithMutavRole({ minRole }) throws ForbiddenError with a message containing the requested rung — use \`.rejects.toThrow(/compliance/)\`.

## Coverage matrix

For **each** mutation, cover:

- **Happy path** — all preconditions met → returns Result.success = true, row patched/inserted as expected. Read-what-you-wrote via ctx.db.get.
- **Auth failures** — unauthenticated (throws or Result error per design), wrong agency (ForbiddenError), no staff row / insufficient role / off-ladder role.
- **Machine composition** — attempt from a terminal state → Result error TERMINAL_STATE or ILLEGAL_TRANSITION.
- **Idempotency / duplicates** — where relevant, second call with same key returns Result error DUPLICATE (or similar).
- **Cross-agency isolation** — agency A tries to write to agency B's row → ForbiddenError (or Result NOT_FOUND, matching the design).
- **Audit emission** — for staff mutations, verify a matching mutavAuditLog row exists post-write.
- **Enum restriction** — arg-validator rejection of staff-only enum values in agency mutations and vice versa.

## Rules

- Each test calls setup() for a fresh instance.
- Fixtures inline inside t.run.
- For Result-returning mutations, assert { success: false, error: { code: 'X' } } shape — not just .success.
- Read-what-you-wrote via ctx.db.get(id) after the mutation, .toEqual against literals for the patched fields.

## Verification

\`\`\`
bun run test:convex convex/${DOMAIN}/mutations.test.ts
bun run test:convex convex/${DOMAIN}/
\`\`\`

Iterate up to 5 times. Report:
1. Passing test count for mutations.test.ts alone
2. Total domain count
3. Any deferred tests (with TODO reason)
4. git diff --stat`, { label: 'tests', phase: 'Tests' })

return {
  design,
  impl,
  verifiers: { wrappers: verifiers[0], machine: verifiers[1], audit: verifiers[2] },
  verdict: worstVerdict,
  findings_count: { critical: critical.length, major: major.length, minor: minor.length },
  address_gaps: addressGaps,
  tests,
}
