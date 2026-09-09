/**
 * Field classification registry — the machine-readable transcription of
 * POL-SEC-004 (Data Access Policy) §4.1–§4.3.
 *
 * This file is the single source of truth for "what tier is this column, whose
 * data is it, and under which norm". Every subsequent privacy PR is reviewed
 * against it: a new personal-data column with no row here fails the gate in
 * `./registryCheck.ts`, which runs as an ordinary vitest test.
 *
 * It is deliberately NOT the runtime enforcement point. Purpose checks, masking
 * and reveal live downstream; this is the vocabulary they will be built on and
 * the machine-readable half of the ROPA (LGPD art. 37).
 *
 * The four counsel-owned columns (`purposeIds`, `legalBasis`, `retentionRule`,
 * `ropaActivityId`) are unresolved by design — see `PENDING_COUNSEL`.
 */

/**
 * POL-SEC-004 §4.1. Sensitivity ranks, not budgets: T1 is the *most* sensitive
 * class and T4 the least. A comparison against a tier reads "at least as
 * sensitive as", so it counts down, not up.
 */
export const PII_TIER = {
  /**
   * LGPD art. 5 II closed list (racial origin, religious conviction, political
   * opinion, union/philosophical membership, health or sex life, genetic or
   * biometric data). Collection is prohibited — no schema field may be T0, and
   * `checkPiiRegistry` fails on any entry that declares it. The member exists
   * so the prohibition is expressible, not so it can be used.
   */
  T0: "T0",
  /** Restricted. National identifiers, financial account data, credit-risk data, identity-document images, credential material, unbounded vendor payloads. */
  T1: "T1",
  /** Confidential. Identifying but non-financial: names, contact details, birth date, address, free text, underwriting decision status. */
  T2: "T2",
  /** Internal. Pseudonymous references and non-identifying operational metadata. Still personal data by linkability (LGPD art. 13 §4). */
  T3: "T3",
  /** Public. Aggregates, published NAV, on-chain data, integrity commitments. */
  T4: "T4",
} as const;

export type PiiTier = (typeof PII_TIER)[keyof typeof PII_TIER];

export const PII_TIERS = Object.values(PII_TIER);

/**
 * The tier a field is assigned when its shape is not constrained by the schema.
 *
 * POL-SEC-004 §4.1 escalation rule: a `v.any()` field is T1 until a
 * schema-aware allowlist proves otherwise. `checkPiiRegistry` enforces it
 * against the live schema, so the rule cannot be forgotten when a new
 * `v.any()` column lands.
 */
export const UNCONSTRAINED_FIELD_TIER = PII_TIER.T1;

/**
 * POL-SEC-004 §4.1 aggregation rule: a projection combining three or more T3
 * fields that is unique to one person in the current book renders as T2. The
 * threshold is stated here so a renderer can apply it without re-reading the
 * policy; the registry itself applies it per-field (see `invoices.publicId`).
 */
export const T3_AGGREGATION_THRESHOLD = 3;

/**
 * What kind of thing the value is, independent of how sensitive it is. Tier
 * answers "how carefully is it handled"; data class answers "what is it", which
 * is what a ROPA row and a purpose allowlist are written against.
 */
export const PII_DATA_CLASS = {
  /** CPF or CNPJ in plaintext digits. */
  NATIONAL_ID: "national_id",
  /** Bank account, agency, account type, Pix key. */
  FINANCIAL_ACCOUNT: "financial_account",
  /** Credit score, risk tier, negative credit-behaviour record. */
  CREDIT_RISK: "credit_risk",
  /** Scanned identity document (RG/CNH) or a handle that mints one. */
  IDENTITY_DOCUMENT: "identity_document",
  /** Secrets and bearer credentials — anything a reader can present as authority. */
  CREDENTIAL: "credential",
  /** Unbounded third-party payload (`v.any()`). Shape unknown, contents unknown. */
  VENDOR_PAYLOAD: "vendor_payload",
  NAME: "name",
  /** Email address, phone number. */
  CONTACT: "contact",
  BIRTH_DATE: "birth_date",
  ADDRESS: "address",
  /** Operator-authored prose. May embed anything the author typed. */
  FREE_TEXT: "free_text",
  /** The output of an assessment about a person: approval, KYC outcome. */
  DECISION_OUTCOME: "decision_outcome",
  /** Amounts a person or agency owes or was billed. */
  FINANCIAL_OBLIGATION: "financial_obligation",
  /** Keyed HMAC or hash standing in for an identifier. Pseudonymous, not anonymous. */
  PSEUDONYM: "pseudonym",
  /** Professional licence number (CRECI). */
  PROFESSIONAL_ID: "professional_id",
  CONSENT_RECORD: "consent_record",
  /** IP address, user agent, referer. */
  ONLINE_IDENTIFIER: "online_identifier",
  /** Ids, publicIds, statuses, timestamps, counters — linkable, not identifying. */
  OPERATIONAL_REFERENCE: "operational_reference",
  /** Stellar addresses, muxed ids, transaction hashes. Permanently public. */
  ON_CHAIN_REFERENCE: "on_chain_reference",
  /** Hash-chain links and Merkle roots. Commitments, not data about a person. */
  INTEGRITY_COMMITMENT: "integrity_commitment",
} as const;

export type PiiDataClass = (typeof PII_DATA_CLASS)[keyof typeof PII_DATA_CLASS];

/**
 * Whose personal data the field is. POL-SEC-004 §6.2 data-subject categories,
 * split finer where the schema distinguishes people the policy groups.
 */
export const SUBJECT_TYPE = {
  /** The natural or legal person being underwritten. */
  TENANT: "tenant",
  /** The named contact natural person at a corporate (pj) tenant — a different human from the tenant. */
  TENANT_CONTACT: "tenant_contact",
  /** The agency as a legal person, plus the natural persons linked to it through its CNPJ/CPF. */
  AGENCY: "agency",
  /** The agency's legal representative — the human whose ID document and CPF back the KYB. */
  LEGAL_REPRESENTATIVE: "legal_representative",
  /**
   * A `users` row: any authenticated human on the platform, agency staff or
   * Mutav staff. POL-SEC-004 §4.2 labels these rows "staff"; the schema does
   * not distinguish them at this table, so neither does the registry.
   */
  PLATFORM_USER: "platform_user",
  /** A human acting inside one agency's scope. */
  AGENCY_STAFF: "agency_staff",
  /** A human holding a Mutav-internal capability grant. */
  MUTAV_STAFF: "mutav_staff",
  /** A waitlist signup from the marketing site. */
  LEAD: "lead",
  /** Whoever settles an invoice — not necessarily the tenant or the agency. */
  PAYER: "payer",
  /** A fund investor. Not modelled in Convex yet; the schema already names the category. */
  INVESTOR: "investor",
  /** No natural or legal person is the subject of this field. */
  NONE: "none",
} as const;

export type SubjectType = (typeof SUBJECT_TYPE)[keyof typeof SUBJECT_TYPE];

/**
 * Sentinel for a column that only counsel can fill in.
 *
 * `purposeIds`, `legalBasis`, `retentionRule` and `ropaActivityId` are legal
 * determinations, not engineering ones. They are blocked on NE-02 (the ROPA,
 * which generates the purpose enum) and NE-07 (the Lei 9.613 art. 9º
 * classification, which sets the AML retention floor at 5 or 10 years — a
 * five-year spread that must not be guessed).
 *
 * Guessing a value here would produce a ROPA row that is wrong in exactly the
 * way an auditor checks first. The sentinel keeps the blocker enumerable:
 * `pendingCounselDeterminations()` lists every unresolved cell and
 * `domain.test.ts` asserts the list is non-empty, so the day counsel returns an
 * answer the failing test is the reminder to record it.
 */
export const PENDING_COUNSEL = "PENDING_COUNSEL";
export type PendingCounsel = typeof PENDING_COUNSEL;

/** The columns `PENDING_COUNSEL` may occupy. Drives the enumeration helper. */
export const COUNSEL_OWNED_COLUMNS = [
  "purposeIds",
  "legalBasis",
  "retentionRule",
  "ropaActivityId",
] as const;

export type CounselOwnedColumn = (typeof COUNSEL_OWNED_COLUMNS)[number];

/** One registry row: everything known about one field path in one table. */
export type PiiFieldClassification = {
  readonly tier: PiiTier;
  readonly dataClass: PiiDataClass;
  readonly subjectType: SubjectType;
  /**
   * The norm that makes this field what it is, where POL-SEC-004 cites one.
   * Engineering-determined (a citation, not a determination) — distinct from
   * `legalBasis`, which is the art. 7 basis counsel must choose. `null` where
   * the policy cites nothing specific.
   */
  readonly legalNormRef: string | null;
  /** Closed-set purpose codes this field may be read under. §7 generates them from the ROPA. */
  readonly purposeIds: readonly string[] | PendingCounsel;
  /** LGPD art. 7 (or art. 11) basis for processing this field. */
  readonly legalBasis: string | PendingCounsel;
  /** How long the field is kept and what ends it. */
  readonly retentionRule: string | PendingCounsel;
  /** The ROPA activity this field belongs to (LGPD art. 37). */
  readonly ropaActivityId: string | PendingCounsel;
  /** Why this tier, where the answer is not obvious from the field name. */
  readonly note?: string;
};

/**
 * Spread into every row. One place to see that four columns are unresolved,
 * and a resolved row is a visible diff over this constant rather than a silent
 * divergence.
 */
const COUNSEL_PENDING = {
  purposeIds: PENDING_COUNSEL,
  legalBasis: PENDING_COUNSEL,
  retentionRule: PENDING_COUNSEL,
  ropaActivityId: PENDING_COUNSEL,
} as const;

// Local aliases so each registry row fits one readable line. Same frozen
// objects exported above — not a parallel vocabulary.
const TIER = PII_TIER;
const CLASS = PII_DATA_CLASS;
const SUBJECT = SUBJECT_TYPE;

/**
 * Tables holding personal data. **Every** field in these tables carries a
 * registry row, including operational ones (classified T3/T4) — a table is
 * either fully classified or explicitly out of scope, never partially covered.
 */
export const PERSONAL_DATA_TABLES = [
  "agencies",
  "users",
  "memberships",
  "mutavStaff",
  "tenants",
  "contractApplications",
  "contracts",
  "contractHistory",
  "contractDelinquencyNotices",
  "invoices",
  "bearerAccessAttempts",
  "payments",
  "stellarIndexState",
  "providerOrders",
  "anchorAccounts",
  "anchorWebhookEvents",
  "agencyBankAccounts",
  "agencyDocuments",
  "claimedDocuments",
  "mutavAuditLog",
  "waitlist",
  "tenantCreditReports",
  "creditAnalysisSignals",
  "creditAnalysisAssessments",
] as const;

/**
 * Tables deliberately excluded, with the reason. POL-SEC-004 §2.3 puts public
 * on-chain data and non-identifying aggregates out of scope.
 *
 * A new table belongs in exactly one of the two lists. `checkPiiRegistry` fails
 * on a table that is in neither, so adding one forces the decision instead of
 * letting it default.
 */
export const OUT_OF_SCOPE_TABLES = {
  mutavAuditAnchors:
    "Merkle roots and their submission metadata. §4.2 records `rootHash` as T4 and states plainly that it is not personal data; §2.3 puts published on-chain records out of scope. Every column here is an integrity commitment or a submission outcome about a transaction, not about a person.",
  reserveSnapshots:
    "Reserve valuation snapshots — token contract addresses, balances, an FX rate and a total. §2.3 excludes aggregate outputs where no individual is identifiable, and no column here is keyed to a person.",
} as const;

/**
 * POL-SEC-004 §4.2, transcribed. Keys are dotted field paths as produced by
 * walking the schema validator: nested objects join with `.`, array elements
 * carry `[]`, and a union table (`tenants`) contributes the union of every
 * arm's fields.
 *
 * Where §4.2 assigns a tier, that tier is reproduced verbatim even where a
 * later schema change has arguably moved the field. Where §4.2 is silent — the
 * policy predates several tables — the row carries a `note` naming the field it
 * was classified by analogy with.
 */
export const PII_FIELD_REGISTRY = {
  agencies: {
    name: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Egresses via the unauthenticated invoice bearer read.",
    },
    cnpj: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: "Lei 9.613/1998 art. 10",
      note: "Plaintext-indexed `by_cnpj`. Sent to Etherfuse as the KYB idNumber.",
    },
    cpf: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: "Lei 9.613/1998 art. 10",
      note: "Plaintext-indexed `by_cpf`. The autonomo's own CPF.",
    },
    createdAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    agencyType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    onboardingState: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    onboardingSubmittedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    email: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
    phone: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
    creci: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PROFESSIONAL_ID,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    "bankingInfo.bank": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Bundled with `.account`; tier follows the bundle.",
    },
    "bankingInfo.agency": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Bundled with `.account`; tier follows the bundle.",
    },
    "bankingInfo.account": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "The account number itself — the field the rest of the `bankingInfo` bundle inherits its tier from. Masked to the last 4.",
    },
    "bankingInfo.accountType": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Bundled with `.account`; tier follows the bundle.",
    },
    "bankingInfo.pixKey": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "A Pix key is frequently *itself* a CPF, phone or email, so a partial reveal is a partial reveal of that identifier.",
    },
    onboardingRejectionReason: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Free text — may embed anything the reviewer typed.",
    },
    consentMarketing: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.CONSENT_RECORD,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: "LGPD art. 8",
      note: "Currently written, never read.",
    },
    representanteName: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: null,
    },
    representanteCpf: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: "Lei 9.613/1998 art. 10",
      note: "The legal representative's own CPF, collected for KYB. A different human from the agency.",
    },
    auth0OrgId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    invoiceRef: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Random per-agency invoice prefix; it replaced the CNPJ-last-4 scheme precisely so it would carry no identifier.",
    },
    nextInvoiceSequence: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Per-agency counter, deliberately not global.",
    },
  },

  users: {
    publicId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
    },
    subject: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Auth0 `sub`. Credential-adjacent — never render, never log in cleartext outside the actor field.",
    },
    name: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Copied into `contractHistory.username`.",
    },
    email: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Plaintext-indexed `by_email`.",
    },
    createdAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
    },
    isStaff: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Deprecated; superseded by the `mutavStaff` table.",
    },
  },

  memberships: {
    userId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
    role: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
    joinedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
  },

  mutavStaff: {
    userId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.MUTAV_STAFF,
      legalNormRef: null,
      note: "T3 by content, but reveals internal authority — §4.2 requires it be access-controlled as T2. Tier and access rule are separate axes; do not raise the tier to encode the access rule.",
    },
    role: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.MUTAV_STAFF,
      legalNormRef: null,
      note: "Access-controlled as T2 — see `userId`.",
    },
    createdAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.MUTAV_STAFF,
      legalNormRef: null,
    },
    addedBy: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.MUTAV_STAFF,
      legalNormRef: null,
      note: "Access-controlled as T2 — see `userId`.",
    },
  },

  // Highest-risk table. `tenants` is `defineTable(v.union(pf, pj))`, so the
  // rows below are the union of both arms: `birthDate` exists only on pf,
  // `contactCpf` only on pj, and both need classifying.
  tenants: {
    entityType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    taxId: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "Lei 12.414 art. 15",
      note: "CPF or CNPJ. Plaintext-indexed `by_taxId`. Transmitted to credit bureaus and to SEP-6/24 anchors as the SEP-9 id_number.",
    },
    fullName: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Egresses in email and WhatsApp bodies.",
    },
    birthDate: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.BIRTH_DATE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "pf arm only.",
    },
    email: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Egresses to Resend and to anchors.",
    },
    phone: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Egresses to the WhatsApp gateway.",
    },
    contactCpf: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.TENANT_CONTACT,
      legalNormRef: null,
      note: "pj arm only. A different natural person from the tenant.",
    },
  },

  // Not in §4.2 — the table postdates the policy. Classified by analogy, and
  // the analogy is named per row. Both `subjectHash` and `cep` are personal
  // data: a keyed HMAC of a CPF is pseudonymous, not anonymous (art. 13 §4),
  // and a CEP is a documented race/class proxy in Brazil (§4.3, E-13).
  contractApplications: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    subjectHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "Not in §4.2. Keyed HMAC of the tax ID — classified by analogy with `creditAnalysisSignals.subjectHash` (T2). Pseudonymised, not anonymised.",
    },
    entityType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    propertyKind: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    cep: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.ADDRESS,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 11 §1",
      note: "Not in §4.2. Classified by analogy with `contracts.property.cep` (T2). §4.3 names CEP a race/class proxy, so it is also an input the sensitive-inference guard (E-13) must see.",
    },
    rentCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. Classified by analogy with `contracts.rental.*Cents` (T2).",
    },
    openedBy: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    openedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  contracts: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    publicId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
    },
    tenantId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
    },
    "tenantApproval.status": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.DECISION_OUTCOME,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 20",
      note: "Underwriting outcome — an automated decision, so the subject may demand its criteria.",
    },
    "tenantApproval.termApprovedAt": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    score: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 12 §2; Sumula 550/STJ",
      note: "Credit score is personal data by art. 12 §2. Masked to a band under operational purposes; full under dsr / regulatory / underwriting-review, where disclosure is legally compelled.",
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
    },
    activatedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    deactivatedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    nextRenewalDate: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    availableGuaranteeCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.propertyKind": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "rental.plan": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "rental.rentCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.condoCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.otherFeesCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.totalRentCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.feeCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.oneTimeActivationFeeCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "rental.setupInstallments": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2 — a count, not an amount.",
    },
    "rental.exitCostMultiplier": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. Legacy prod rows hold bespoke strings here.",
    },
    "rental.rentMultiplier": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. Legacy prod rows hold bespoke strings here.",
    },
    "rental.payer": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PAYER,
      legalNormRef: null,
      note: "Not in §4.2. A role label ('Recorrencia via Imobiliaria'), not a named person.",
    },
    "rental.pviMigrationSchedule": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "property.cep": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.ADDRESS,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 11 §1",
      note: "The tenant's home address. §4.3 names CEP a race/class proxy — an input the sensitive-inference guard (E-13) must see.",
    },
    "property.streetAndNumber": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.ADDRESS,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "property.neighborhood": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.ADDRESS,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "property.cityUF": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ADDRESS,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "§4.2: city + UF alone is T3; it is the rest of the address block that lifts to T2.",
    },
    "optional.complement": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.ADDRESS,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "optional.tag": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "optional.description": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "documents[].key": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. A document-slot name, not a document.",
    },
    "documents[].status": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  // The append-only PII duplicate: a frozen "as-signed" copy of the tenant.
  contractHistory: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    contractPublicId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
    },
    at: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    username: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
      note: "Copy of `users.name`.",
    },
    message: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Free text; the seed writes tenant names into it.",
    },
    "tenantSnapshot.entityType": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. Mirrors `tenants.entityType` (T3).",
    },
    "tenantSnapshot.taxId": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "Lei 12.414 art. 15",
      note: "Frozen as-signed copy of the tenant's CPF/CNPJ.",
    },
    "tenantSnapshot.fullName": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "tenantSnapshot.email": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "tenantSnapshot.phone": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "tenantSnapshot.birthDate": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.BIRTH_DATE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "tenantSnapshot.contactCpf": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.NATIONAL_ID,
      subjectType: SUBJECT.TENANT_CONTACT,
      legalNormRef: null,
      note: "Frozen as-signed copy of the pj tenant's contact CPF — a second, unerasable location for a T1 identifier.",
    },
  },

  contractDelinquencyNotices: {
    publicId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    contractId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "The join that makes this whole row attributable to a named person.",
    },
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "CDC art. 43 §1",
      note: "§4.2 puts `status` in the T1 group with the amounts, not with the other status columns: joined to `tenants` via `contractId` it is a negative credit-behaviour record about a named natural person.",
    },
    rentDueDate: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "CDC art. 43 §1",
      note: "Dates the missed payment, which is what turns the row into a negative credit-behaviour record about a named natural person. CDC art. 43 §1 caps reporting of negative information at five years.",
    },
    originalAmountCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "CDC art. 43 §1",
      note: "The arrears amount. Full within the `default` purpose; masked to `R$ ****` everywhere else.",
    },
    updatedAmountCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "CDC art. 43 §1",
      note: "The arrears amount as juros and multa accrue. Same masking rule as `originalAmountCents`.",
    },
    evidenceSource: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    openedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    openedByUserId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY_STAFF,
      legalNormRef: null,
    },
    "resolution.kind": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "CDC art. 43 §1",
      note: "Not in §4.2. Classified by analogy with `status` (T1): 'tenant_cured' vs 'cover_committed' is the outcome of the negative record, which is the record.",
    },
    "resolution.resolvedAt": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "resolution.resolvedByUserId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
    },
    "resolution.coverOperationPublicId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "resolution.note": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    "cancellation.reason": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. A cancelled notice is a withdrawn claim, not a negative record — the reason codes are administrative.",
    },
    "cancellation.canceledAt": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "cancellation.canceledByUserId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
    },
    "cancellation.note": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
  },

  invoices: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    publicId: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "§4.2 sets T2 under the aggregation rule, on the ground that the document number embedded the CNPJ/CPF last-4 and doubled as the bearer credential. Neither is still true — the scheme is now `INV-{random agency prefix}-{counter}` and the credential moved to `accessToken`. The policy tier is reproduced as written; retiring it is a policy amendment, not a registry edit.",
    },
    accessToken: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2 — the column postdates the policy. T1 under the §4.1 clause covering credential material: this is stored verbatim, so a read of the column is a working bearer credential for the unauthenticated checkout.",
    },
    accessTokenExpiresAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Credential lifecycle metadata, not the credential.",
    },
    accessTokenRevokedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Credential lifecycle metadata, not the credential.",
    },
    periodMonth: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    issuedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    dueDate: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    totalCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2 as a row, but §6.4 grants `anon.bearer` masked T2 sight of 'the invoice amount for the single invoice named by the bearer link' — which places the amount at T2.",
    },
    "state.kind": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "state.paidAt": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    muxedId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "On-chain and permanently linkable once correlated.",
    },
    "lineItems[].contractId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "lineItems[].contractPublicId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "lineItems[].kind": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "lineItems[].amountCents": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Follows `totalCents`, which it sums to.",
    },
    "lineItems[].description": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
  },

  // Not in §4.2 — the table postdates the policy. It is the deny log for the
  // unauthenticated bearer surface, keyed by the presented token.
  bearerAccessAttempts: {
    scope: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2. A single literal today.",
    },
    key: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. This is the presented bearer token, stored verbatim — T1 under the §4.1 credential-material clause, same as `invoices.accessToken`. Rows only exist for tokens that already resolved to a real invoice, so the column is also a set of live credentials.",
    },
    windowStartedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    count: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    deniedCount: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. The deny log R-LOG-4 requires.",
    },
    lastDeniedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  payments: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    invoiceId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PAYER,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    amountCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Follows `invoices.totalCents`.",
    },
    paidAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PAYER,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    externalRef: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    providerOrderId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "method.kind": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PAYER,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "method.barcode": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.PAYER,
      legalNormRef: null,
      note: "Not in §4.2. A boleto linha digitavel carries bank, amount, due date and a free field that commonly embeds the beneficiary's account — an obligation, not an account identifier, so T2 rather than the T1 of `method.pixKey`.",
    },
    "method.destinationAddress": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    "method.txHash": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    "method.pixKey": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.PAYER,
      legalNormRef: null,
      note: "A Pix key is frequently itself a CPF, phone or email. Returned today by an unauthenticated query (E-02).",
    },
    "method.txId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
  },

  stellarIndexState: {
    sourceAccount: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "The Mutav treasury account. On-chain, permanently linkable once correlated.",
    },
    cursor: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2. A Horizon paging token.",
    },
    lastRunAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  providerOrders: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    invoiceId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    provider: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    anchorTxId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    instructions: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.VENDOR_PAYLOAD,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "`v.any()` — T1 by the §4.1 escalation rule. Carries the Pix BR code, `pix_chave` and the beneficiary name. Not renderable until a schema-aware allowlist exists (E-07).",
    },
    how: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Free-form deposit summary from the anchor.",
    },
    hostedUrl: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Bearer URL into the anchor's interactive flow.",
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    amountInCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Follows `invoices.totalCents`.",
    },
    amountOutCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Follows `invoices.totalCents`.",
    },
    feeCents: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FINANCIAL_OBLIGATION,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Follows `invoices.totalCents`.",
    },
    createdAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    completedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    rawPayload: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.VENDOR_PAYLOAD,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "`v.any()` — T1 by the §4.1 escalation rule. Unbounded anchor payload that may echo the SEP-9 prefill, including the tenant's CPF.",
    },
  },

  anchorAccounts: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    provider: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.DECISION_OUTCOME,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: "Lei 9.613/1998 art. 10",
      note: "Not in §4.2. The normalised mirror of `data.kycStatus` (T2) — same KYC outcome about the same human.",
    },
    externalId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    createdAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    updatedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "data.provider": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2. The union discriminant.",
    },
    "data.publicKey": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    "data.encryptedSecret.ciphertext": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "The agency proxy's Stellar seed. Already envelope-encrypted — the correct pattern. Never rendered under any purpose.",
    },
    "data.encryptedSecret.iv": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Part of the envelope; tier follows the bundle.",
    },
    "data.encryptedSecret.authTag": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDENTIAL,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Part of the envelope; tier follows the bundle.",
    },
    "data.bankAccountId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    "data.provisioningTxHash": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ON_CHAIN_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "data.kycStatus": {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.DECISION_OUTCOME,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: "Lei 9.613/1998 art. 10",
      note: "KYC outcome about the legal representative.",
    },
  },

  anchorWebhookEvents: {
    provider: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    eventId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
    },
    eventType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    payload: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.VENDOR_PAYLOAD,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "`v.any()` — T1 by the §4.1 escalation rule. The full vendor webhook body, stored verbatim, never read back, no retention rule and no person-keyed index.",
    },
    receivedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    processedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  agencyBankAccounts: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    anchorAccountId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    externalBankAccountId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2. Etherfuse's UUID, not the account number.",
    },
    type: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    accountNumber: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.FINANCIAL_ACCOUNT,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Plaintext. Returned today by an unauthenticated query (E-02).",
    },
    accountHolderName: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: null,
    },
    etherfuseCreatedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    syncedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  agencyDocuments: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    kind: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: null,
      note: "Not in §4.2 as a row; §8.2 makes document metadata (kind, uploadedAt, verified) the only renderable part of this table.",
    },
    storageId: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.IDENTITY_DOCUMENT,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: "Lei 9.613/1998 art. 10",
      note: "Handle to a scanned RG/CNH. Minting a signed URL from it is a disclosure, not a read (E-04).",
    },
    fileName: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.NAME,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: null,
      note: "Often contains the person's name.",
    },
    uploadedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.LEGAL_REPRESENTATIVE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  claimedDocuments: {
    documentHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: "LGPD art. 13 §4",
      note: "Keyed HMAC of a CPF/CNPJ. Pseudonymised, not anonymised — still personal data, and the plaintext it commits to lives one table away in `agencies.cpf`/`.cnpj`.",
    },
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    claimedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  mutavAuditLog: {
    "actor.kind": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Not in §4.2. The actor union discriminant.",
    },
    "actor.userId": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Indexed `by_actor_userId`. Personal data about the *actor* — the log is itself in scope (§2.2).",
    },
    "actor.source": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2. A service identity, not a person.",
    },
    action: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    resourceType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    resourceId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "May be a `tenants` Id — a pseudonymous reference to a named person.",
    },
    payloadHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "Unpeppered SHA-256 over payloads that for TENANT_DATA_CONFLICT contain CPF + name + birth date, and for STAFF_BOOTSTRAP contain email + Auth0 sub. The entropy floor is a CPF: 9 base digits plus 2 check digits is ~10^9 valid values, exhaustible in minutes on commodity hardware, so the digest is a reversible identifier under a Convex compromise. T1 on two independent grounds — the §4.1 escalation rule (the payload shape is unconstrained) and the fact that it commits to a CPF+name+DOB tuple, which is T1 content whatever transform is applied. See E-12.",
    },
    prevHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T4,
      dataClass: CLASS.INTEGRITY_COMMITMENT,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Chain link over entry hashes, not over payloads. Not personal data — retained indefinitely.",
    },
    entryHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T4,
      dataClass: CLASS.INTEGRITY_COMMITMENT,
      subjectType: SUBJECT.NONE,
      legalNormRef: null,
      note: "Not personal data — retained indefinitely.",
    },
    timestamp: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.PLATFORM_USER,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },

  waitlist: {
    email: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.CONTACT,
      subjectType: SUBJECT.LEAD,
      legalNormRef: "LGPD art. 7 I",
      note: "Plaintext-indexed. Egresses to Resend with no deletion propagation. Consent-based, so this is the only data reachable by an art. 18 VI erasure request.",
    },
    audience: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.LEAD,
      legalNormRef: null,
    },
    ts: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.LEAD,
      legalNormRef: null,
    },
    ip: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.ONLINE_IDENTIFIER,
      subjectType: SUBJECT.LEAD,
      legalNormRef: "LGPD art. 5 I",
      note: "An online identifier is personal data. Collected, never read — which violates art. 6 III necessidade. Delete the column (E-11).",
    },
    ua: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ONLINE_IDENTIFIER,
      subjectType: SUBJECT.LEAD,
      legalNormRef: null,
      note: "Collected, never read (E-11).",
    },
    referer: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.ONLINE_IDENTIFIER,
      subjectType: SUBJECT.LEAD,
      legalNormRef: null,
      note: "Collected, never read (E-11).",
    },
  },

  // §4.2 lists this table only to call it dead ("zero readers, zero writers,
  // delete — E-09") and assigns no tiers. It is still in the schema, so it is
  // still classified: an unclassified table is exactly what this registry
  // exists to prevent, and "we meant to delete it" is not a classification.
  // Tiers mirror the `creditAnalysis*` tables that superseded it.
  tenantCreditReports: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
      note: "Not tiered in §4.2 — dead table pending deletion (E-09).",
    },
    cpfHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "Not tiered in §4.2. Classified by analogy with `creditAnalysisSignals.subjectHash` (T2) — same HMAC, same key.",
    },
    score: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 12 §2",
      note: "Not tiered in §4.2. Classified by analogy with `creditAnalysisAssessments.score` (T1).",
    },
    tier: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 12 §2",
      note: "Not tiered in §4.2. Classified by analogy with `creditAnalysisAssessments.tier` (T1).",
    },
    provider: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not tiered in §4.2. The bureau named — a disclosure recipient (R-LOG-7).",
    },
    providerRef: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not tiered in §4.2. Classified by analogy with `creditAnalysisSignals.vendorRef` (T3).",
    },
    pulledAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not tiered in §4.2.",
    },
  },

  creditAnalysisSignals: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    subjectType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    subjectHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "Keyed HMAC of the CPF. A pseudonym, not an anonym.",
    },
    capability: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    provider: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. The bureau named — a disclosure recipient (R-LOG-7).",
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    "normalized.score": {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 12 §2; Lei 12.414 art. 5 IV",
      note: "Masked to a band under operational purposes; full under dsr / regulatory / underwriting-review.",
    },
    "normalized.scale": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. A per-provider constant, not a value about the person — but §8.2 requires it be released *with* the score whenever the score is, since a score without its scale is not an answer.",
    },
    error: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.FREE_TEXT,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "`String(e)` — may embed the document that was queried.",
    },
    vendorRef: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
    },
    correlationId: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "Literally `${subjectHash}:${windowKey}` — it inherits the pseudonym.",
    },
    windowKey: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2. The UTC-day idempotency bucket.",
    },
    pulledAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    applicationId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "Lei 12.414 art. 15",
      note: "Not in §4.2. Attribution of the consultation to a declared relationship.",
    },
    legalBasis: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 7 X",
      note: "Not in §4.2. The recorded basis for this consultation — data about the processing, not about the person. Distinct from this row's own `legalBasis` column, which is the unresolved counsel determination.",
    },
  },

  creditAnalysisAssessments: {
    agencyId: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.AGENCY,
      legalNormRef: null,
    },
    subjectType: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    subjectHash: {
      ...COUNSEL_PENDING,
      tier: TIER.T2,
      dataClass: CLASS.PSEUDONYM,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 13 §4",
      note: "Keyed HMAC of the CPF. A pseudonym, not an anonym.",
    },
    policyVersion: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 20 §1",
      note: "Not in §4.2. Names the aggregation policy that produced the decision — part of the art. 20 §1 criteria the subject may demand.",
    },
    "signalIds[]": {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 20 §1",
      note: "Not in §4.2. The decision's provenance.",
    },
    status: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
    score: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 12 §2; Sumula 550/STJ",
      note: "The automated decision input — art. 20 provenance.",
    },
    tier: {
      ...COUNSEL_PENDING,
      tier: TIER.T1,
      dataClass: CLASS.CREDIT_RISK,
      subjectType: SUBJECT.TENANT,
      legalNormRef: "LGPD art. 12 §2; Sumula 550/STJ",
      note: "The automated decision input — art. 20 provenance.",
    },
    assessedAt: {
      ...COUNSEL_PENDING,
      tier: TIER.T3,
      dataClass: CLASS.OPERATIONAL_REFERENCE,
      subjectType: SUBJECT.TENANT,
      legalNormRef: null,
      note: "Not in §4.2.",
    },
  },
} as const satisfies Record<string, Record<string, PiiFieldClassification>>;

export type PiiRegistry = typeof PII_FIELD_REGISTRY;
export type PersonalDataTable = (typeof PERSONAL_DATA_TABLES)[number];
export type OutOfScopeTable = keyof typeof OUT_OF_SCOPE_TABLES;

/** One unresolved counsel cell. */
export type PendingCounselDetermination = {
  readonly table: string;
  readonly fieldPath: string;
  readonly column: CounselOwnedColumn;
};

/**
 * Every counsel-owned cell still holding the sentinel. Non-empty today by
 * construction; `domain.test.ts` asserts it, so resolving the last one is a
 * deliberate act with a failing test attached rather than a silent default.
 */
export function pendingCounselDeterminations(): PendingCounselDetermination[] {
  const pending: PendingCounselDetermination[] = [];
  for (const [table, fields] of Object.entries(PII_FIELD_REGISTRY)) {
    for (const [fieldPath, row] of Object.entries<PiiFieldClassification>(fields)) {
      for (const column of COUNSEL_OWNED_COLUMNS) {
        if (row[column] === PENDING_COUNSEL) pending.push({ table, fieldPath, column });
      }
    }
  }
  return pending;
}

/** Look up one field's classification. `undefined` means unclassified — the drift the gate catches. */
export function classificationFor(
  table: string,
  fieldPath: string,
): PiiFieldClassification | undefined {
  const fields: Record<string, PiiFieldClassification> | undefined = Object.hasOwn(
    PII_FIELD_REGISTRY,
    table,
  )
    ? PII_FIELD_REGISTRY[table as keyof PiiRegistry]
    : undefined;
  return fields && Object.hasOwn(fields, fieldPath) ? fields[fieldPath] : undefined;
}

/** Every field path classified at a given tier, as `table.fieldPath`. */
export function fieldPathsAtTier(tier: PiiTier): string[] {
  const paths: string[] = [];
  for (const [table, fields] of Object.entries(PII_FIELD_REGISTRY)) {
    for (const [fieldPath, row] of Object.entries<PiiFieldClassification>(fields)) {
      if (row.tier === tier) paths.push(`${table}.${fieldPath}`);
    }
  }
  return paths;
}
