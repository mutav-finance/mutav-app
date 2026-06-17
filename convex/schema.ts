import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Literals duplicated below in `convex/agencies/domain.ts` as the canonical
// `agencyDocumentKindValidator`. Kept inline here because entity-file imports
// would create a circular dependency through `_generated/dataModel`.
const agencyDocumentKind = v.union(v.literal("documento_empresa"), v.literal("responsavel_id"));

const contractStatus = v.union(
  v.literal("ativo"),
  v.literal("encerrado"),
  v.literal("pendente"),
  v.literal("cancelado"),
);

const documentStatus = v.union(v.literal("pendente"), v.literal("enviado"), v.literal("aprovado"));

const documentKey = v.union(
  v.literal("rentalContract"),
  v.literal("inspection"),
  v.literal("policy"),
);

const propertyKind = v.union(v.literal("residencial"), v.literal("comercial"));

// `rental.exitCostMultiplier`, `rental.rentMultiplier`, and `rental.payer` all
// persist as `v.string()` (set directly on the rental object). Legacy prod rows
// hold bespoke values across these fields ("6x" / "40x" / "Recorrência via
// Imobiliária") alongside canonical ones. Writes still funnel through
// `DEFAULT_*` constants from `convex/contracts/domain.ts` for type discipline;
// the schema just doesn't reject the legacy data.

const tenantApprovalStatus = v.union(
  v.literal("aprovado"),
  v.literal("pendente"),
  v.literal("reprovado"),
);

const invoiceLineItemKind = v.union(v.literal("recurring"), v.literal("activation"));

/**
 * Discriminated union representing the lifecycle state of an invoice.
 * Each variant carries only the fields that are meaningful for that state.
 * `overdue` is not stored — it's derived from `open` + a past `dueDate`.
 */
const invoiceState = v.union(
  v.object({ kind: v.literal("open") }),
  v.object({ kind: v.literal("paid"), paidAt: v.string() }),
  v.object({ kind: v.literal("void") }),
);

/**
 * Discriminated union representing the chosen payment method.
 * null = agency has not yet selected a method (invoice issued, awaiting choice).
 *
 * - boleto:   traditional Brazilian bank slip; barcode null until PSP registers it.
 * - stellar:  on-chain payment via Stellar network (XLM / USDC); txHash null until confirmed.
 * - pix:      Brazilian instant payment; txId null until confirmed.
 */
const invoiceMethod = v.union(
  v.null(),
  v.object({
    kind: v.literal("boleto"),
    barcode: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal("stellar"),
    destinationAddress: v.string(),
    txHash: v.union(v.string(), v.null()),
  }),
  v.object({
    kind: v.literal("pix"),
    pixKey: v.string(),
    txId: v.union(v.string(), v.null()),
  }),
);

const memberRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));

const agencyType = v.union(v.literal("autonomo"), v.literal("empresa"));

const onboardingState = v.union(
  v.literal("not_started"),
  v.literal("in_progress"),
  v.literal("submitted"),
  v.literal("under_review"),
  v.literal("active"),
  v.literal("rejected"),
);

const bankingInfo = v.object({
  bank: v.string(),
  agency: v.optional(v.string()),
  account: v.string(),
  accountType: v.union(v.literal("corrente"), v.literal("poupanca")),
  pixKey: v.optional(v.string()),
});

/**
 * Anchor on-ramp lifecycle, normalized across providers. Mirrors SEP-24
 * status values; non-SEP providers (Etherfuse later) map their states to
 * this same set. Terminal states: `completed`, `refunded`, `expired`, `error`.
 */
const anchorOrderStatus = v.union(
  v.literal("incomplete"),
  v.literal("pending_user_transfer_start"),
  v.literal("pending_user_transfer_complete"),
  v.literal("pending_anchor"),
  v.literal("pending_stellar"),
  v.literal("completed"),
  v.literal("refunded"),
  v.literal("expired"),
  v.literal("error"),
);

const anchorOrderProvider = v.union(v.literal("testanchor"), v.literal("etherfuse"));

/**
 * Onboarding status of an agency with a single anchor provider. Normalized
 * across providers (Etherfuse, Bitso, …) so the UI renders one status pill
 * regardless of which anchor's KYC flow produced it.
 */
const anchorOnboardingStatus = v.union(
  v.literal("not_started"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

/**
 * Provider-specific fields for an `anchorAccounts` row, discriminated by
 * `provider`. Adding a new anchor = register its name in
 * `src/lib/anchors/registry.ts` AND append a variant here. Testanchor needs
 * no per-agency config — its variant exists for the union's default arm.
 */
const anchorAccountData = v.union(
  v.object({
    provider: v.literal("testanchor"),
  }),
  v.object({
    provider: v.literal("etherfuse"),
    // Per-agency Stellar proxy account. publicKey is the G-address
    // registered with Etherfuse; encryptedSecret holds the AES-GCM envelope
    // of the secret seed (see convex/lib/secrets.ts for encrypt/decrypt).
    publicKey: v.string(),
    encryptedSecret: v.object({
      ciphertext: v.string(),
      iv: v.string(),
      authTag: v.string(),
    }),
    // Both UUIDs are client-generated and registered with Etherfuse via
    // POST /ramp/onboarding-url. Persisted forever per agency (one G-address
    // ↔ one Etherfuse customer globally — see anchorAccounts.externalId).
    bankAccountId: v.string(),
    // Hash of the Stellar tx that created the proxy account and opened the
    // TESOURO trustline. Absent until the on-chain submit confirms — the
    // row is inserted before submission so a mid-flow failure still leaves
    // the encrypted secret recoverable (any TESOURO landing on the
    // G-address would otherwise be unspendable).
    provisioningTxHash: v.optional(v.string()),
    // KYC state mirrors src/lib/anchors/etherfuse/types.ts → KycStatus.
    // Sandbox flips proposed → approved on POST /ramp/customer/{id}/kyc;
    // production gates on real KYC review. Orders are rejected until approved.
    kycStatus: v.union(
      v.literal("not_started"),
      v.literal("proposed"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
  }),
);

export default defineSchema({
  agencies: defineTable({
    name: v.string(),
    cnpj: v.optional(v.string()),
    cpf: v.optional(v.string()),
    createdAt: v.string(),
    agencyType: v.optional(agencyType),
    onboardingState: v.optional(onboardingState),
    onboardingSubmittedAt: v.optional(v.union(v.string(), v.null())),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    creci: v.optional(v.string()),
    bankingInfo: v.optional(bankingInfo),
    onboardingRejectionReason: v.optional(v.string()),
    consentMarketing: v.optional(v.boolean()),
    representanteName: v.optional(v.string()),
    representanteCpf: v.optional(v.string()),
    // Auth0 Organization id (e.g. `org_xxx`). Populated when the agency
    // is provisioned through the Auth0 Orgs path (see #121). Legacy
    // agencies stay Convex-only with this field absent — wrappers MUST
    // tolerate both shapes during the migration window.
    auth0OrgId: v.optional(v.string()),
  })
    .index("by_cnpj", ["cnpj"])
    .index("by_cpf", ["cpf"])
    .index("by_onboardingState", ["onboardingState"])
    .index("by_auth0OrgId", ["auth0OrgId"]),

  users: defineTable({
    publicId: v.string(),
    // Auth0 JWT subject claim (`{issuer}|{userId}` format). Populated by
    // `getOrCreateByIdentity` on first login. Optional only to tolerate
    // legacy rows pre-dating the Auth0 wiring; new rows always carry it.
    subject: v.optional(v.string()),
    name: v.string(),
    email: v.string(),
    createdAt: v.string(),
    // True for Mutav internal staff members (who admin the system,
    // approve agencies, etc). False/absent for regular users (corretores).
    isStaff: v.optional(v.boolean()),
  })
    .index("by_publicId", ["publicId"])
    .index("by_email", ["email"])
    .index("by_subject", ["subject"]),

  memberships: defineTable({
    userId: v.id("users"),
    agencyId: v.id("agencies"),
    role: memberRole,
    joinedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_agency", ["agencyId"])
    .index("by_user_agency", ["userId", "agencyId"]),

  contracts: defineTable({
    agencyId: v.id("agencies"),
    publicId: v.string(),
    tenantCpf: v.optional(v.string()),
    status: contractStatus,
    activatedAt: v.union(v.string(), v.null()),
    deactivatedAt: v.optional(v.union(v.string(), v.null())),
    nextRenewalDate: v.string(),
    availableGuaranteeCents: v.number(),

    rental: v.object({
      propertyKind,
      rentCents: v.number(),
      condoCents: v.number(),
      otherFeesCents: v.number(),
      totalRentCents: v.number(),
      feeCents: v.number(),
      oneTimeActivationFeeCents: v.number(),
      setupInstallments: v.number(),
      exitCostMultiplier: v.string(),
      rentMultiplier: v.string(),
      payer: v.string(),
      pviMigrationSchedule: v.union(v.string(), v.null()),
    }),

    property: v.object({
      cep: v.string(),
      streetAndNumber: v.string(),
      neighborhood: v.string(),
      cityUF: v.string(),
    }),

    optional: v.object({
      complement: v.string(),
      tag: v.string(),
      description: v.string(),
    }),

    documents: v.array(
      v.object({
        key: documentKey,
        status: documentStatus,
      }),
    ),

    tenant: v.object({
      approvalStatus: tenantApprovalStatus,
      entityType: v.optional(v.union(v.literal("pf"), v.literal("pj"))),
      fullName: v.string(),
      cpf: v.string(),
      cnpj: v.optional(v.string()),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
      score: v.optional(v.number()),
      termApprovedAt: v.union(v.string(), v.null()),
    }),
  })
    .index("by_publicId", ["publicId"])
    .index("by_status", ["status"])
    .index("by_agency_status", ["agencyId", "status"])
    .index("by_agency_tenant_cpf", ["agencyId", "tenantCpf"]),

  contractHistory: defineTable({
    agencyId: v.id("agencies"),
    contractPublicId: v.string(),
    at: v.string(),
    username: v.string(),
    message: v.string(),
  }).index("by_contract", ["contractPublicId", "at"]),

  invoices: defineTable({
    agencyId: v.id("agencies"),
    publicId: v.string(),
    periodMonth: v.string(),
    issuedAt: v.string(),
    dueDate: v.string(),
    totalCents: v.number(),
    state: invoiceState,
    method: invoiceMethod,
    // 63-bit unsigned int as digit string; derives the per-invoice `M…`
    // address. Optional for rows created before this field existed.
    muxedId: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        contractId: v.id("contracts"),
        contractPublicId: v.string(),
        kind: invoiceLineItemKind,
        amountCents: v.number(),
        description: v.string(),
      }),
    ),
  })
    .index("by_agency_period", ["agencyId", "periodMonth"])
    .index("by_state_kind", ["state.kind"])
    .index("by_publicId", ["publicId"])
    .index("by_muxedId", ["muxedId"]),

  // Singleton row tracking the latest Horizon paging token seen by the
  // treasury polling action. Inserted lazily on first run.
  stellarIndexState: defineTable({
    sourceAccount: v.string(),
    cursor: v.string(),
    lastRunAt: v.string(),
  }).index("by_sourceAccount", ["sourceAccount"]),

  // One row per anchor-mediated on-ramp attempt against an `invoices` row.
  // 1:N from invoices (retries create new rows). On terminal `completed`,
  // the parent invoice's state flips to `paid` via `markPaidByAnchor`.
  // `rawPayload` retains the last full anchor-side transaction object for
  // debugging / audit.
  providerOrders: defineTable({
    agencyId: v.id("agencies"),
    invoiceId: v.id("invoices"),
    provider: anchorOrderProvider,
    anchorTxId: v.string(),
    /**
     * SEP-6 deposit instructions returned by the anchor: key-value pairs
     * the user / our UI uses to make the payment (PIX key, QR string,
     * bank account info, memo, etc.). Shape varies per provider; renderer
     * detects known Pix-shaped fields (`pix_qr_code`, `pix_chave`) or
     * falls back to a generic key-value panel. Optional because some
     * anchors may return `how` instead of structured instructions.
     */
    instructions: v.optional(v.any()),
    /** Free-form deposit summary text from SEP-6 `how` field. */
    how: v.optional(v.string()),
    /**
     * SEP-24 interactive deposit URL. Present only for orders kicked off via
     * the hosted-UI path (`startAnchorTestOnramp`). The client either iframes
     * this or opens it in a popup; status updates still come from the
     * `anchors:poll*` action loop.
     */
    hostedUrl: v.optional(v.string()),
    status: anchorOrderStatus,
    amountInCents: v.optional(v.number()),
    amountOutCents: v.optional(v.number()),
    feeCents: v.optional(v.number()),
    createdAt: v.string(),
    completedAt: v.optional(v.string()),
    rawPayload: v.optional(v.any()),
  })
    .index("by_agency", ["agencyId"])
    .index("by_invoice", ["invoiceId"])
    .index("by_anchor_tx", ["anchorTxId"]),

  // One row per (agency × anchor provider) onboarding relationship. Embeds
  // provider-specific fields under the discriminated `data` block; common
  // lifecycle fields (status, external id, timestamps) live at the top
  // level. Webhook reconciliation resolves by `(provider, externalId)`.
  anchorAccounts: defineTable({
    agencyId: v.id("agencies"),
    provider: anchorOrderProvider,
    status: anchorOnboardingStatus,
    /** Provider's own identifier (Etherfuse orgId, Bitso accountId, …). null until provisioned. */
    externalId: v.union(v.string(), v.null()),
    createdAt: v.string(),
    updatedAt: v.string(),
    data: anchorAccountData,
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_provider", ["agencyId", "provider"])
    .index("by_provider_externalId", ["provider", "externalId"]),

  // Inbound anchor webhook log. The handler dedupes on `(provider, eventId)`
  // so duplicate Etherfuse deliveries (which can arrive twice per
  // docs.etherfuse.com/guides/verifying-webhooks) don't double-advance an
  // order's state. Payload kept as v.any() because providers ship different
  // event shapes; the handler narrows per `provider + eventType`.
  //
  // `processedAt` is null between insert and successful processing; if a
  // retry arrives with null processedAt the handler reprocesses instead
  // of returning "duplicate, ignored" — otherwise a crash during the
  // first processing would pin the order forever.
  anchorWebhookEvents: defineTable({
    provider: anchorOrderProvider,
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    receivedAt: v.string(),
    processedAt: v.optional(v.string()),
  }).index("by_provider_eventId", ["provider", "eventId"]),

  // Per-agency funding sources used to pay Mutav's monthly insurance
  // invoices via the anchor on-ramp. Mirror of Etherfuse's per-customer
  // bank list, kept local so the checkout picker renders without a
  // round-trip and so we can validate a chosen account before handing
  // it to /ramp/order. Reconciled by `syncEtherfuseBankAccounts`.
  //
  // Naming is provider-agnostic on purpose — `externalBankAccountId` is
  // Etherfuse's UUID today; a future provider would just add rows with
  // its own external identifier.
  agencyBankAccounts: defineTable({
    agencyId: v.id("agencies"),
    anchorAccountId: v.id("anchorAccounts"),
    externalBankAccountId: v.string(),
    type: v.union(v.literal("pix"), v.literal("spei")),
    accountNumber: v.string(),
    accountHolderName: v.string(),
    etherfuseCreatedAt: v.string(),
    syncedAt: v.string(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_external_id", ["externalBankAccountId"]),

  agencyDocuments: defineTable({
    agencyId: v.id("agencies"),
    kind: agencyDocumentKind,
    storageId: v.id("_storage"),
    fileName: v.string(),
    uploadedAt: v.string(),
  })
    .index("by_agency", ["agencyId"])
    .index("by_agency_kind", ["agencyId", "kind"]),

  // Server-side claim on a national document (CPF | CNPJ). The row stores
  // only the HMAC-SHA256 of the document (`hashPii(digits)`); the
  // plaintext lives only in the encrypted columns of the owning agency.
  // Inserted by `submitOnboarding` *before* patching the agency state, so
  // two concurrent submissions for the same document race on the same
  // `by_documentHash` row — Convex OCC serializes, the loser fails its
  // read-set conflict and on retry returns ALREADY_REGISTERED.
  //
  // Lifecycle: insert on submit, delete on `reviewOnboarding(rejected)`
  // (CPF freed), retain on `reviewOnboarding(approved)` (agency ACTIVE).
  claimedDocuments: defineTable({
    documentHash: v.string(),
    agencyId: v.id("agencies"),
    claimedAt: v.string(),
  }).index("by_documentHash", ["documentHash"]),

  // Hash-chained audit log of money-moving and lifecycle-changing actions.
  // Every state-changing mutation in `invoices/` and `contracts/` appends
  // one row via `appendAuditEntry` (see `convex/audit/useCases.ts`).
  //
  // Chain invariant: every entry's `prevHash` equals the previous entry's
  // `entryHash`. The first entry uses `GENESIS_PREV_HASH` (64 zero hex
  // chars). `entryHash` is SHA-256 over the canonicalized entry contents.
  // Tampering with any historical entry invalidates the chain from that
  // point forward — verifiable at any time by recomputing entryHashes and
  // re-walking the prevHash links.
  //
  // P1b will daily-Merkle-anchor the latest `entryHash` to Stellar via a
  // treasury memo tx, making the chain externally verifiable even if the
  // entire Convex deployment is compromised.
  //
  // `actor` is a discriminated union — see `convex/audit/domain.ts`:
  // - { kind: "user", userId }     — human via an auth wrapper
  // - { kind: "system", source }   — webhook, cron, or scheduled action
  mutavAuditLog: defineTable({
    actor: v.union(
      v.object({ kind: v.literal("user"), userId: v.id("users") }),
      v.object({ kind: v.literal("system"), source: v.string() }),
    ),
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    payloadHash: v.string(),
    prevHash: v.string(),
    entryHash: v.string(),
    timestamp: v.number(),
  })
    .index("by_resource", ["resourceType", "resourceId", "timestamp"])
    .index("by_actor_userId", ["actor.userId"])
    .index("by_timestamp", ["timestamp"])
    .index("by_entryHash", ["entryHash"]),

  // Periodic Merkle anchor of the audit chain. One row per submission
  // attempt by the daily cron. The `rootHash` is the Merkle root over
  // every `mutavAuditLog.entryHash` in `[periodStart, periodEnd)`; the
  // `stellarTxHash` is the on-chain witness submitted as MEMO_HASH on a
  // dedicated single-sig account.
  //
  // Status lifecycle:
  // - `pending`   — row inserted, Stellar tx not yet submitted (dev/preview
  //                 mode without AUDIT_ANCHOR_SECRET, or transient state
  //                 between computeAuditAnchor and submitDailyAnchor).
  // - `submitted` — Stellar tx accepted by Horizon; `stellarTxHash` populated.
  // - `failed`    — Stellar tx submission threw; `stellarTxHash` null,
  //                 `failureReason` set. Cron retries next day with a fresh
  //                 row covering the same period (loser stays as audit
  //                 trail of the attempt).
  //
  // `stellarNetwork` is null only on `pending` dev rows that were never
  // submitted; once `submitted` or `failed`, it records which network the
  // attempt targeted so a deployment moved between testnet/mainnet doesn't
  // produce confusing cross-network anchor history.
  mutavAuditAnchors: defineTable({
    rootHash: v.string(),
    stellarTxHash: v.union(v.string(), v.null()),
    stellarNetwork: v.union(v.literal("testnet"), v.literal("public"), v.null()),
    periodStart: v.number(),
    periodEnd: v.number(),
    entryCount: v.number(),
    anchoredAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("submitted"), v.literal("failed")),
    failureReason: v.union(v.string(), v.null()),
  })
    .index("by_status", ["status", "anchoredAt"])
    .index("by_periodEnd", ["periodEnd"]),

  // The asset object mirrors reserveAssetValidator in convex/reserve/domain.ts (including valueCents) — kept inline here because importing an entity file into schema.ts would create a circular dependency through _generated/dataModel (same reason as agencyDocumentKind above).
  reserveSnapshots: defineTable({
    storedValueCents: v.number(),
    fxUsdBrl: v.number(),
    fxSource: v.string(),
    fxQuotedAt: v.string(),
    assets: v.array(
      v.object({
        contractAddress: v.string(),
        symbol: v.string(),
        decimals: v.number(),
        rawBalance: v.string(),
        valueCents: v.number(),
      }),
    ),
    capturedAt: v.number(),
  }).index("by_capturedAt", ["capturedAt"]),

  // Anonymous public waitlist for the marketing site (mutav-website).
  // One row per (audience, email). Dedup is enforced in the `join` mutation
  // via the `by_email_audience` index — the table itself has no unique
  // constraint primitive. Audit fields (`ip`, `ua`, `referer`) are best-effort
  // and may be missing if request headers don't expose them.
  waitlist: defineTable({
    email: v.string(),
    audience: v.union(v.literal("investidor"), v.literal("imobiliaria")),
    ts: v.number(),
    ip: v.optional(v.string()),
    ua: v.optional(v.string()),
    referer: v.optional(v.string()),
  })
    .index("by_email_audience", ["email", "audience"])
    .index("by_audience_ts", ["audience", "ts"]),

  // Per-agency credit report cache. One row per lookup; never mutated after
  // insert. The `cpfHash` is HMAC-SHA256 of the CPF/CNPJ digits (same key as
  // `claimedDocuments`) so we can index without storing plaintext PII.
  // `pulledAt` is a unix ms timestamp — used for the 24-hour cache window.
  // `providerRef` is the bureau's own query ID for audit/dispute trail.
  tenantCreditReports: defineTable({
    agencyId: v.id("agencies"),
    cpfHash: v.string(),
    score: v.number(),
    tier: v.union(v.literal("bom"), v.literal("regular"), v.literal("ruim"), v.literal("negado")),
    provider: v.string(),
    providerRef: v.optional(v.string()),
    pulledAt: v.number(),
  }).index("by_agency_cpf_time", ["agencyId", "cpfHash", "pulledAt"]),
});
