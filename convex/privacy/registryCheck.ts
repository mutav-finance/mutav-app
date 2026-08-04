/**
 * The gate that keeps `./domain.ts` honest against `../schema.ts`.
 *
 * It walks the **runtime** schema validators rather than parsing the source.
 * A validator tree is what Convex actually enforces, so the walk cannot drift
 * from the real schema the way a regex or an AST heuristic can, and it gets
 * union tables right for free: `tenants` is `defineTable(v.union(pf, pj))`, and
 * merging both arms is what makes `birthDate` (pf-only) and `contactCpf`
 * (pj-only) both appear.
 *
 * `checkPiiRegistry` is the single implementation of the rule. The vitest gate
 * in `./domain.test.ts` and the developer script in
 * `scripts/check-pii-registry.ts` both call it; neither restates it.
 */

import {
  OUT_OF_SCOPE_TABLES,
  PERSONAL_DATA_TABLES,
  PII_FIELD_REGISTRY,
  PII_TIER,
  UNCONSTRAINED_FIELD_TIER,
  classificationFor,
  type PiiFieldClassification,
} from "./domain";

/**
 * The walk takes the validator as `unknown` and narrows with guards rather than
 * declaring a structural type for it. Convex's generated validator types
 * (`VObject`, `VUnion`, `VLiteral`, …) are far more specific than the four
 * branches this walk cares about — `VLiteral.value` is the literal itself, not
 * a nested validator — so any hand-written shape would either fail to accept
 * the real schema or need a cast to force it. Narrowing at the boundary is the
 * repo's rule for exactly this case.
 */
type SchemaLike = {
  readonly tables: Readonly<Record<string, { readonly validator: unknown }>>;
};

/** A leaf field discovered in the schema: its dotted path and whether its shape is constrained. */
export type SchemaField = {
  readonly fieldPath: string;
  /** True for `v.any()` — the trigger for the POL-SEC-004 §4.1 escalation rule. */
  readonly isUnconstrained: boolean;
};

const ANY_VALIDATOR_KIND = "any";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readKind(node: Record<string, unknown>): string | undefined {
  return typeof node.kind === "string" ? node.kind : undefined;
}

function walkValidator(node: unknown, prefix: string, found: Map<string, SchemaField>): void {
  if (!isRecord(node)) return;

  switch (readKind(node)) {
    case "object": {
      if (!isRecord(node.fields)) return;
      for (const [key, child] of Object.entries(node.fields)) {
        walkValidator(child, prefix ? `${prefix}.${key}` : key, found);
      }
      return;
    }
    // Union arms are merged, not branched: a field present on any arm is a
    // field that can exist at rest, so every arm's fields need classifying.
    case "union": {
      if (!Array.isArray(node.members)) return;
      for (const member of node.members) walkValidator(member, prefix, found);
      return;
    }
    // Optionality reaches us as a flag on the leaf validator, not as a wrapper
    // kind. The branch stays for the wrapped form so a Convex change to either
    // representation walks the same.
    case "optional":
      walkValidator(node.value, prefix, found);
      return;
    case "array":
      walkValidator(node.element, `${prefix}[]`, found);
      return;
    default: {
      const isUnconstrained = readKind(node) === ANY_VALIDATOR_KIND;
      const existing = found.get(prefix);
      // A path reachable through several union arms keeps the strictest
      // reading: unconstrained on any arm is unconstrained.
      found.set(prefix, {
        fieldPath: prefix,
        isUnconstrained: isUnconstrained || (existing?.isUnconstrained ?? false),
      });
    }
  }
}

/** Every leaf field path in one table, unions merged, arrays marked with `[]`. */
export function schemaFieldsForTable(schema: SchemaLike, table: string): readonly SchemaField[] {
  const found = new Map<string, SchemaField>();
  walkValidator(schema.tables[table]?.validator, "", found);
  return [...found.values()];
}

export const PII_REGISTRY_FINDING = {
  /** A table in the schema is in neither list. Adding a table must be a decision. */
  UNLISTED_TABLE: "UNLISTED_TABLE",
  /** A table is in both lists. */
  DOUBLE_LISTED_TABLE: "DOUBLE_LISTED_TABLE",
  /** A list names a table the schema does not have. */
  UNKNOWN_TABLE: "UNKNOWN_TABLE",
  /** A field in a personal-data table has no registry row. The drift guard. */
  UNCLASSIFIED_FIELD: "UNCLASSIFIED_FIELD",
  /** A registry row points at a field path the schema no longer has. */
  ORPHAN_REGISTRY_ROW: "ORPHAN_REGISTRY_ROW",
  /** A registry row declares T0. §4.3: collection of art. 5 II sensitive data is prohibited. */
  SENSITIVE_TIER_DECLARED: "SENSITIVE_TIER_DECLARED",
  /** A `v.any()` field is classified below T1, contradicting the §4.1 escalation rule. */
  ESCALATION_RULE_VIOLATED: "ESCALATION_RULE_VIOLATED",
  /** An out-of-scope table nonetheless carries registry rows. */
  OUT_OF_SCOPE_TABLE_CLASSIFIED: "OUT_OF_SCOPE_TABLE_CLASSIFIED",
} as const;

export type PiiRegistryFindingKind =
  (typeof PII_REGISTRY_FINDING)[keyof typeof PII_REGISTRY_FINDING];

export type PiiRegistryFinding = {
  readonly kind: PiiRegistryFindingKind;
  readonly table: string;
  readonly fieldPath?: string;
  readonly detail: string;
};

/**
 * Run the whole rule against a schema. Returns every finding rather than
 * throwing on the first, so one run shows a reviewer the complete gap.
 */
export function checkPiiRegistry(schema: SchemaLike): PiiRegistryFinding[] {
  const findings: PiiRegistryFinding[] = [];

  const schemaTables = Object.keys(schema.tables);
  const personalDataTables: readonly string[] = PERSONAL_DATA_TABLES;
  const outOfScopeTables = Object.keys(OUT_OF_SCOPE_TABLES);

  for (const table of schemaTables) {
    const isPersonal = personalDataTables.includes(table);
    const isOutOfScope = outOfScopeTables.includes(table);

    if (isPersonal && isOutOfScope) {
      findings.push({
        kind: PII_REGISTRY_FINDING.DOUBLE_LISTED_TABLE,
        table,
        detail: `\`${table}\` is in both PERSONAL_DATA_TABLES and OUT_OF_SCOPE_TABLES. Pick one.`,
      });
      continue;
    }

    if (!isPersonal && !isOutOfScope) {
      findings.push({
        kind: PII_REGISTRY_FINDING.UNLISTED_TABLE,
        table,
        detail: `\`${table}\` is in the schema but in neither PERSONAL_DATA_TABLES nor OUT_OF_SCOPE_TABLES. Classify it or record why it is out of scope — a new table must force the decision.`,
      });
      continue;
    }

    if (isOutOfScope) {
      if (Object.hasOwn(PII_FIELD_REGISTRY, table)) {
        findings.push({
          kind: PII_REGISTRY_FINDING.OUT_OF_SCOPE_TABLE_CLASSIFIED,
          table,
          detail: `\`${table}\` is declared out of scope but carries registry rows. Move it to PERSONAL_DATA_TABLES or drop the rows.`,
        });
      }
      continue;
    }

    for (const field of schemaFieldsForTable(schema, table)) {
      const row: PiiFieldClassification | undefined = classificationFor(table, field.fieldPath);

      if (!row) {
        findings.push({
          kind: PII_REGISTRY_FINDING.UNCLASSIFIED_FIELD,
          table,
          fieldPath: field.fieldPath,
          detail: `\`${table}.${field.fieldPath}\` has no row in PII_FIELD_REGISTRY. Every field in a personal-data table carries a tier, including operational ones (T3/T4).`,
        });
        continue;
      }

      if (field.isUnconstrained && row.tier !== UNCONSTRAINED_FIELD_TIER) {
        findings.push({
          kind: PII_REGISTRY_FINDING.ESCALATION_RULE_VIOLATED,
          table,
          fieldPath: field.fieldPath,
          detail: `\`${table}.${field.fieldPath}\` is \`v.any()\` and classified ${row.tier}. POL-SEC-004 §4.1: an unconstrained field is ${UNCONSTRAINED_FIELD_TIER} until a schema-aware allowlist proves otherwise.`,
        });
      }
    }

    const schemaPaths = new Set(
      schemaFieldsForTable(schema, table).map((field) => field.fieldPath),
    );
    const registeredPaths = Object.hasOwn(PII_FIELD_REGISTRY, table)
      ? Object.keys(PII_FIELD_REGISTRY[table as keyof typeof PII_FIELD_REGISTRY])
      : [];
    for (const fieldPath of registeredPaths) {
      if (!schemaPaths.has(fieldPath)) {
        findings.push({
          kind: PII_REGISTRY_FINDING.ORPHAN_REGISTRY_ROW,
          table,
          fieldPath,
          detail: `\`${table}.${fieldPath}\` is classified but no longer exists in the schema. Drop the row so the registry keeps describing the system that exists.`,
        });
      }
    }
  }

  for (const table of [...personalDataTables, ...outOfScopeTables]) {
    if (!Object.hasOwn(schema.tables, table)) {
      findings.push({
        kind: PII_REGISTRY_FINDING.UNKNOWN_TABLE,
        table,
        detail: `\`${table}\` is listed but is not a table in the schema.`,
      });
    }
  }

  for (const [table, fields] of Object.entries(PII_FIELD_REGISTRY)) {
    for (const [fieldPath, row] of Object.entries<PiiFieldClassification>(fields)) {
      if (row.tier === PII_TIER.T0) {
        findings.push({
          kind: PII_REGISTRY_FINDING.SENSITIVE_TIER_DECLARED,
          table,
          fieldPath,
          detail: `\`${table}.${fieldPath}\` is classified T0. POL-SEC-004 §4.3 asserts T0 is empty: collection of art. 5 II sensitive data is prohibited, so a T0 row means either the column must go or the assertion is false.`,
        });
      }
    }
  }

  return findings;
}

/** Human-readable render of a finding set, for the vitest failure message and the dev script. */
export function formatFindings(findings: readonly PiiRegistryFinding[]): string {
  if (findings.length === 0) return "PII registry is in sync with the schema.";
  return findings
    .map((finding) => `[${finding.kind}] ${finding.detail}`)
    .sort()
    .join("\n");
}
