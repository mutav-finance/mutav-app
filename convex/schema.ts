import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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

const tenantApprovalStatus = v.union(
  v.literal("aprovado"),
  v.literal("pendente"),
  v.literal("reprovado"),
);

const paymentLineItemKind = v.union(v.literal("recurring"), v.literal("activation"));

/**
 * Discriminated union representing the lifecycle state of a payment.
 * Each variant carries only the fields that are meaningful for that state.
 */
const paymentState = v.union(
  v.object({ kind: v.literal("pending") }),
  v.object({ kind: v.literal("paid"), paidAt: v.string() }),
  v.object({ kind: v.literal("overdue") }),
  v.object({ kind: v.literal("canceled") }),
);

/**
 * Discriminated union representing the chosen payment method.
 * null = agency has not yet selected a method (invoice issued, awaiting choice).
 *
 * - boleto:   traditional Brazilian bank slip; barcode null until PSP registers it.
 * - stellar:  on-chain payment via Stellar network (XLM / USDC); txHash null until confirmed.
 * - pix:      Brazilian instant payment; txId null until confirmed.
 */
const paymentMethod = v.union(
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
    cnpj: v.string(),
    createdAt: v.string(),
  }).index("by_cnpj", ["cnpj"]),

  users: defineTable({
    publicId: v.string(),
    name: v.string(),
    email: v.string(),
    createdAt: v.string(),
  })
    .index("by_publicId", ["publicId"])
    .index("by_email", ["email"]),

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

  payments: defineTable({
    agencyId: v.id("agencies"),
    publicId: v.string(),
    periodMonth: v.string(),
    issuedAt: v.string(),
    dueDate: v.string(),
    totalCents: v.number(),
    state: paymentState,
    method: paymentMethod,
    // 63-bit unsigned int as digit string; derives the per-payment `M…`
    // address. Optional for rows created before this field existed.
    muxedId: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        contractId: v.id("contracts"),
        contractPublicId: v.string(),
        kind: paymentLineItemKind,
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

  // One row per anchor-mediated on-ramp attempt against a `payments` row.
  // 1:N from payments (retries create new rows). On terminal `completed`,
  // the parent payment's state flips to `paid` via `markPaidByAnchor`.
  // `rawPayload` retains the last full anchor-side transaction object for
  // debugging / audit.
  anchorOrders: defineTable({
    agencyId: v.id("agencies"),
    paymentId: v.id("payments"),
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
    .index("by_payment", ["paymentId"])
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
  anchorWebhookEvents: defineTable({
    provider: anchorOrderProvider,
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    receivedAt: v.string(),
  }).index("by_provider_eventId", ["provider", "eventId"]),
});
