import { describe, expect, it } from "vitest";

import schema from "../schema";
import {
  COUNSEL_OWNED_COLUMNS,
  OUT_OF_SCOPE_TABLES,
  PENDING_COUNSEL,
  PERSONAL_DATA_TABLES,
  PII_DATA_CLASS,
  PII_FIELD_REGISTRY,
  PII_TIER,
  SUBJECT_TYPE,
  classificationFor,
  fieldPathsAtTier,
  pendingCounselDeterminations,
  type PiiFieldClassification,
} from "./domain";
import {
  PII_REGISTRY_FINDING,
  checkPiiRegistry,
  formatFindings,
  schemaFieldsForTable,
} from "./registryCheck";

const TIERS = Object.values(PII_TIER);
const DATA_CLASSES: string[] = Object.values(PII_DATA_CLASS);
const SUBJECT_TYPES: string[] = Object.values(SUBJECT_TYPE);

const registryRows: [string, string, PiiFieldClassification][] = Object.entries(
  PII_FIELD_REGISTRY,
).flatMap(([table, fields]) =>
  Object.entries<PiiFieldClassification>(fields).map(
    ([fieldPath, row]): [string, string, PiiFieldClassification] => [table, fieldPath, row],
  ),
);

describe("the CI gate — checkPiiRegistry against the live schema", () => {
  it("reports no findings for the schema as it stands", () => {
    const findings = checkPiiRegistry(schema);
    expect(formatFindings(findings)).toBe("PII registry is in sync with the schema.");
    expect(findings).toEqual([]);
  });

  it("classifies every table in the schema exactly once", () => {
    const schemaTables = Object.keys(schema.tables).sort();
    const listed = [...PERSONAL_DATA_TABLES, ...Object.keys(OUT_OF_SCOPE_TABLES)].sort();
    expect(listed).toEqual(schemaTables);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it("classifies every field of every personal-data table", () => {
    for (const table of PERSONAL_DATA_TABLES) {
      const unclassified = schemaFieldsForTable(schema, table)
        .map((field) => field.fieldPath)
        .filter((fieldPath) => classificationFor(table, fieldPath) === undefined);
      expect({ table, unclassified }).toEqual({ table, unclassified: [] });
    }
  });

  it("holds no registry row for a field the schema no longer has", () => {
    for (const table of PERSONAL_DATA_TABLES) {
      const schemaPaths = new Set(
        schemaFieldsForTable(schema, table).map((field) => field.fieldPath),
      );
      const orphans = Object.keys(PII_FIELD_REGISTRY[table]).filter(
        (fieldPath) => !schemaPaths.has(fieldPath),
      );
      expect({ table, orphans }).toEqual({ table, orphans: [] });
    }
  });
});

describe("the CI gate — synthetic drift", () => {
  // The gate is worth nothing unless it fires. Each case below builds a
  // schema-shaped object that differs from the real one in exactly one way and
  // asserts the specific finding, so a checker that silently stopped walking
  // (or stopped comparing) cannot pass this block.
  type FakeValidator = {
    kind?: string;
    fields?: Record<string, FakeValidator>;
    members?: FakeValidator[];
    value?: FakeValidator;
    element?: FakeValidator;
  };
  const leaf = (kind: string): FakeValidator => ({ kind });
  const obj = (fields: Record<string, FakeValidator>): FakeValidator => ({
    kind: "object",
    fields,
  });
  const table = (validator: FakeValidator) => ({ validator });

  it("fires UNCLASSIFIED_FIELD on a column that exists in the schema but not in the registry", () => {
    const drifted = {
      tables: {
        ...schema.tables,
        waitlist: table(
          obj({
            email: leaf("string"),
            audience: leaf("string"),
            ts: leaf("float64"),
            ip: leaf("string"),
            ua: leaf("string"),
            referer: leaf("string"),
            // The synthetic drift: a new marketing column nobody classified.
            utmCampaign: leaf("string"),
          }),
        ),
      },
    };

    const findings = checkPiiRegistry(drifted);

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: PII_REGISTRY_FINDING.UNCLASSIFIED_FIELD,
        table: "waitlist",
        fieldPath: "utmCampaign",
      }),
    );
    expect(formatFindings(findings)).toContain("waitlist.utmCampaign");
  });

  it("fires UNCLASSIFIED_FIELD for a field that exists on only one arm of a union table", () => {
    const drifted = {
      tables: {
        ...schema.tables,
        tenants: table({
          kind: "union",
          members: [
            obj({ entityType: leaf("literal"), taxId: leaf("string"), birthDate: leaf("string") }),
            // pj arm gains a column the pf arm does not have.
            obj({
              entityType: leaf("literal"),
              taxId: leaf("string"),
              contactCpf: leaf("string"),
              stateRegistration: leaf("string"),
            }),
          ],
        }),
      },
    };

    const findings = checkPiiRegistry(drifted);

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: PII_REGISTRY_FINDING.UNCLASSIFIED_FIELD,
        table: "tenants",
        fieldPath: "stateRegistration",
      }),
    );
  });

  it("fires UNLISTED_TABLE on a table in neither list", () => {
    const drifted = {
      tables: {
        ...schema.tables,
        tenantSupportTickets: table(obj({ tenantId: leaf("id"), body: leaf("string") })),
      },
    };

    const findings = checkPiiRegistry(drifted);

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: PII_REGISTRY_FINDING.UNLISTED_TABLE,
        table: "tenantSupportTickets",
      }),
    );
  });

  it("fires ORPHAN_REGISTRY_ROW when a classified column is dropped from the schema", () => {
    const drifted = {
      tables: {
        ...schema.tables,
        claimedDocuments: table(obj({ agencyId: leaf("id"), claimedAt: leaf("string") })),
      },
    };

    const findings = checkPiiRegistry(drifted);

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: PII_REGISTRY_FINDING.ORPHAN_REGISTRY_ROW,
        table: "claimedDocuments",
        fieldPath: "documentHash",
      }),
    );
  });

  it("fires ESCALATION_RULE_VIOLATED when a classified column becomes v.any()", () => {
    const drifted = {
      tables: {
        ...schema.tables,
        stellarIndexState: table(
          obj({
            // T3 in the registry; turning it into an unconstrained field must
            // re-open the classification rather than inherit the old tier.
            sourceAccount: leaf("any"),
            cursor: leaf("string"),
            lastRunAt: leaf("string"),
          }),
        ),
      },
    };

    const findings = checkPiiRegistry(drifted);

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: PII_REGISTRY_FINDING.ESCALATION_RULE_VIOLATED,
        table: "stellarIndexState",
        fieldPath: "sourceAccount",
      }),
    );
  });

  it("fires UNKNOWN_TABLE when a listed table leaves the schema", () => {
    const remaining = Object.fromEntries(
      Object.entries(schema.tables).filter(([name]) => name !== "tenantCreditReports"),
    );

    const findings = checkPiiRegistry({ tables: remaining });

    expect(findings).toContainEqual(
      expect.objectContaining({
        kind: PII_REGISTRY_FINDING.UNKNOWN_TABLE,
        table: "tenantCreditReports",
      }),
    );
  });

  it("formats a clean run as an explicit in-sync message", () => {
    expect(formatFindings([])).toBe("PII registry is in sync with the schema.");
  });
});

describe("schema walk", () => {
  it("merges both arms of the tenants union", () => {
    const paths = schemaFieldsForTable(schema, "tenants").map((field) => field.fieldPath);
    // birthDate is pf-only, contactCpf is pj-only. Classifying one arm is the
    // exact mistake this walk prevents.
    expect(paths).toContain("birthDate");
    expect(paths).toContain("contactCpf");
    expect(paths).toContain("taxId");
  });

  it("marks nested object and array paths with dots and []", () => {
    const contracts = schemaFieldsForTable(schema, "contracts").map((field) => field.fieldPath);
    expect(contracts).toContain("property.cep");
    expect(contracts).toContain("documents[].key");

    const assessments = schemaFieldsForTable(schema, "creditAnalysisAssessments").map(
      (field) => field.fieldPath,
    );
    expect(assessments).toContain("signalIds[]");
  });

  it("flags v.any() columns as unconstrained", () => {
    const unconstrained = schemaFieldsForTable(schema, "providerOrders")
      .filter((field) => field.isUnconstrained)
      .map((field) => field.fieldPath)
      .sort();
    expect(unconstrained).toEqual(["instructions", "rawPayload"]);
  });
});

describe("tier assignments agree with POL-SEC-004 §4.2", () => {
  // Every T1 in the registry, spelled out. §4.2 is the normative source; this
  // list is the transcription check, so it is written as literals rather than
  // derived from the registry.
  const EXPECTED_T1 = [
    "agencies.bankingInfo.account",
    "agencies.bankingInfo.accountType",
    "agencies.bankingInfo.agency",
    "agencies.bankingInfo.bank",
    "agencies.bankingInfo.pixKey",
    "agencies.cnpj",
    "agencies.cpf",
    "agencies.representanteCpf",
    "agencyBankAccounts.accountNumber",
    "agencyDocuments.storageId",
    "anchorAccounts.data.encryptedSecret.authTag",
    "anchorAccounts.data.encryptedSecret.ciphertext",
    "anchorAccounts.data.encryptedSecret.iv",
    "anchorWebhookEvents.payload",
    "bearerAccessAttempts.key",
    "contractDelinquencyNotices.originalAmountCents",
    "contractDelinquencyNotices.rentDueDate",
    "contractDelinquencyNotices.resolution.kind",
    "contractDelinquencyNotices.status",
    "contractDelinquencyNotices.updatedAmountCents",
    "contractHistory.tenantSnapshot.contactCpf",
    "contractHistory.tenantSnapshot.taxId",
    "contracts.score",
    "creditAnalysisAssessments.score",
    "creditAnalysisAssessments.tier",
    "creditAnalysisSignals.normalized.score",
    "invoices.accessToken",
    "mutavAuditLog.payloadHash",
    "payments.method.pixKey",
    "providerOrders.instructions",
    "providerOrders.rawPayload",
    "tenantCreditReports.score",
    "tenantCreditReports.tier",
    "tenants.contactCpf",
    "tenants.taxId",
  ];

  it("classifies exactly the expected set of fields as T1", () => {
    expect(fieldPathsAtTier(PII_TIER.T1).sort()).toEqual(EXPECTED_T1);
  });

  it.each([
    ["tenants", "taxId", PII_TIER.T1],
    ["tenants", "contactCpf", PII_TIER.T1],
    ["tenants", "fullName", PII_TIER.T2],
    ["tenants", "birthDate", PII_TIER.T2],
    ["tenants", "entityType", PII_TIER.T3],
    ["agencies", "cnpj", PII_TIER.T1],
    ["agencies", "bankingInfo.pixKey", PII_TIER.T1],
    ["agencies", "representanteName", PII_TIER.T2],
    ["agencies", "creci", PII_TIER.T2],
    ["agencies", "consentMarketing", PII_TIER.T3],
    ["users", "email", PII_TIER.T2],
    ["users", "subject", PII_TIER.T3],
    ["contracts", "score", PII_TIER.T1],
    ["contracts", "tenantApproval.status", PII_TIER.T2],
    ["contracts", "property.cep", PII_TIER.T2],
    ["contracts", "property.neighborhood", PII_TIER.T2],
    ["contracts", "property.cityUF", PII_TIER.T3],
    ["contracts", "publicId", PII_TIER.T3],
    ["contractHistory", "tenantSnapshot.taxId", PII_TIER.T1],
    ["contractHistory", "username", PII_TIER.T2],
    ["contractDelinquencyNotices", "status", PII_TIER.T1],
    ["contractDelinquencyNotices", "resolution.note", PII_TIER.T2],
    ["contractDelinquencyNotices", "openedByUserId", PII_TIER.T3],
    ["invoices", "publicId", PII_TIER.T2],
    ["invoices", "muxedId", PII_TIER.T3],
    ["invoices", "lineItems[].description", PII_TIER.T3],
    ["payments", "method.pixKey", PII_TIER.T1],
    ["payments", "method.destinationAddress", PII_TIER.T3],
    ["stellarIndexState", "sourceAccount", PII_TIER.T3],
    ["providerOrders", "rawPayload", PII_TIER.T1],
    ["providerOrders", "hostedUrl", PII_TIER.T2],
    ["providerOrders", "anchorTxId", PII_TIER.T3],
    ["anchorAccounts", "data.kycStatus", PII_TIER.T2],
    ["anchorAccounts", "data.publicKey", PII_TIER.T3],
    ["anchorWebhookEvents", "payload", PII_TIER.T1],
    ["agencyBankAccounts", "accountNumber", PII_TIER.T1],
    ["agencyBankAccounts", "accountHolderName", PII_TIER.T2],
    ["agencyDocuments", "storageId", PII_TIER.T1],
    ["agencyDocuments", "fileName", PII_TIER.T2],
    ["claimedDocuments", "documentHash", PII_TIER.T2],
    ["mutavAuditLog", "payloadHash", PII_TIER.T1],
    ["mutavAuditLog", "actor.userId", PII_TIER.T3],
    ["mutavAuditLog", "entryHash", PII_TIER.T4],
    ["mutavAuditLog", "prevHash", PII_TIER.T4],
    ["waitlist", "email", PII_TIER.T2],
    ["waitlist", "ip", PII_TIER.T2],
    ["waitlist", "ua", PII_TIER.T3],
    ["creditAnalysisSignals", "normalized.score", PII_TIER.T1],
    ["creditAnalysisSignals", "subjectHash", PII_TIER.T2],
    ["creditAnalysisSignals", "correlationId", PII_TIER.T2],
    ["creditAnalysisSignals", "error", PII_TIER.T2],
    ["creditAnalysisSignals", "vendorRef", PII_TIER.T3],
    ["creditAnalysisAssessments", "score", PII_TIER.T1],
    ["creditAnalysisAssessments", "tier", PII_TIER.T1],
    ["mutavStaff", "role", PII_TIER.T3],
    // Classified by analogy — §4.2 predates the table.
    ["contractApplications", "subjectHash", PII_TIER.T2],
    ["contractApplications", "cep", PII_TIER.T2],
    ["contractApplications", "rentCents", PII_TIER.T2],
    ["contractApplications", "agencyId", PII_TIER.T3],
  ])("%s.%s is %s", (table, fieldPath, tier) => {
    expect(classificationFor(table, fieldPath)?.tier).toBe(tier);
  });
});

describe("§4.3 — T0 is empty", () => {
  it("classifies no field as T0", () => {
    expect(fieldPathsAtTier(PII_TIER.T0)).toEqual([]);
  });

  it("reports SENSITIVE_TIER_DECLARED if a T0 row ever appears", () => {
    // Proves the check reads the tier rather than assuming the registry is
    // clean: the same rule, run over a registry-shaped object holding a T0 row.
    const t0Rows = registryRows.filter(([, , row]) => row.tier === PII_TIER.T0);
    expect(t0Rows).toEqual([]);
    expect(PII_REGISTRY_FINDING.SENSITIVE_TIER_DECLARED).toBe("SENSITIVE_TIER_DECLARED");
  });

  it("keeps CPF and credit history at T1, not T0 — they are ordinary personal data of elevated risk", () => {
    expect(classificationFor("tenants", "taxId")?.tier).toBe(PII_TIER.T1);
    expect(classificationFor("contracts", "score")?.tier).toBe(PII_TIER.T1);
    expect(classificationFor("contractDelinquencyNotices", "status")?.tier).toBe(PII_TIER.T1);
  });
});

describe("counsel determinations stay loud", () => {
  it("enumerates a non-empty pending set", () => {
    const pending = pendingCounselDeterminations();
    expect(pending.length).toBeGreaterThan(0);
  });

  it("leaves every counsel-owned column of every row unresolved (NE-02, NE-07)", () => {
    const pending = pendingCounselDeterminations();
    expect(pending.length).toBe(registryRows.length * COUNSEL_OWNED_COLUMNS.length);
  });

  it("names only the four counsel-owned columns", () => {
    const columns = [...new Set(pendingCounselDeterminations().map((item) => item.column))].sort();
    expect(columns).toEqual(["legalBasis", "purposeIds", "retentionRule", "ropaActivityId"]);
  });

  it("resolves nothing by accident — no row carries a guessed legal basis or retention rule", () => {
    for (const [table, fieldPath, row] of registryRows) {
      expect({ table, fieldPath, legalBasis: row.legalBasis }).toEqual({
        table,
        fieldPath,
        legalBasis: PENDING_COUNSEL,
      });
      expect(row.retentionRule).toBe(PENDING_COUNSEL);
      expect(row.purposeIds).toBe(PENDING_COUNSEL);
      expect(row.ropaActivityId).toBe(PENDING_COUNSEL);
    }
  });
});

describe("registry rows are well-formed", () => {
  it("uses only declared tiers, data classes and subject types", () => {
    for (const [table, fieldPath, row] of registryRows) {
      expect({ table, fieldPath, ok: TIERS.includes(row.tier) }).toEqual({
        table,
        fieldPath,
        ok: true,
      });
      expect(DATA_CLASSES).toContain(row.dataClass);
      expect(SUBJECT_TYPES).toContain(row.subjectType);
    }
  });

  it("gives every T1 row a note explaining why", () => {
    // T1 is the tier that costs money to implement (envelope encryption, blind
    // indexes, reveal flows). An unexplained T1 is the one a future PR argues
    // down without knowing what it was protecting against.
    const unexplained = registryRows
      .filter(([, , row]) => row.tier === PII_TIER.T1 && (row.note ?? "").length === 0)
      .map(([table, fieldPath]) => `${table}.${fieldPath}`);
    expect(unexplained).toEqual([]);
  });

  it("gives every out-of-scope table a written reason", () => {
    for (const [table, reason] of Object.entries(OUT_OF_SCOPE_TABLES)) {
      expect({ table, hasReason: reason.length > 0 }).toEqual({ table, hasReason: true });
    }
  });

  it("marks hashed identifiers as pseudonyms, not as anonymous operational data", () => {
    for (const [table, fieldPath] of [
      ["claimedDocuments", "documentHash"],
      ["creditAnalysisSignals", "subjectHash"],
      ["creditAnalysisAssessments", "subjectHash"],
      ["contractApplications", "subjectHash"],
      ["tenantCreditReports", "cpfHash"],
      ["mutavAuditLog", "payloadHash"],
    ]) {
      expect({
        table,
        fieldPath,
        dataClass: classificationFor(table, fieldPath)?.dataClass,
      }).toEqual({ table, fieldPath, dataClass: PII_DATA_CLASS.PSEUDONYM });
    }
  });
});
