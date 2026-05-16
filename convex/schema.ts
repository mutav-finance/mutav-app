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
 * - boleto:     traditional Brazilian bank slip; barcode null until PSP registers it.
 * - stellar:    on-chain payment via Stellar network (XLM / USDC); txHash null until confirmed.
 * - pix:        Brazilian instant payment; txId null until confirmed.
 * - pix_anchor: PIX collected by an anchor (e.g. Etherfuse) and bridged to
 *               on-chain USDC on the agency's behalf. Carries a foreign key
 *               into anchorOnRampTransactions for the full transaction state.
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
  v.object({
    kind: v.literal("pix_anchor"),
    anchorOnRampTransactionId: v.id("anchorOnRampTransactions"),
    pixCode: v.string(),
    expiresAt: v.string(),
  }),
);

const memberRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));

/**
 * Per-agency Etherfuse business-KYB onboarding status. Mirrors the KycStatus
 * type from src/lib/anchors/types.ts but scoped to the agency (org) record
 * since BR business KYB is performed once per agency, not per end-user.
 */
const etherfuseOnboardingStatusValidator = v.union(
  v.literal("not_started"),
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("update_required"),
);

/**
 * Lifecycle states for an anchor on/off-ramp transaction. Mirrors the
 * TransactionStatus literal union from src/lib/anchors/types.ts so the
 * vendored Anchor interface maps cleanly to persisted rows.
 */
const transactionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("expired"),
  v.literal("cancelled"),
  v.literal("refunded"),
);

export default defineSchema({
  agencies: defineTable({
    name: v.string(),
    cnpj: v.string(),
    createdAt: v.string(),
    // Etherfuse child-org identifier returned by /organization. Null until
    // the agency completes the business-KYB onboarding flow.
    etherfuseOrgId: v.union(v.string(), v.null()),
    etherfuseOnboardingStatus: etherfuseOnboardingStatusValidator,
    // Etherfuse bank-account identifier — required on every /ramp/order call.
    // Registered once per agency via POST /ramp/customer/{id}/bank-account.
    // Optional in the schema so pre-existing agency rows don't fail
    // validation; the action layer treats `null` and `undefined` equivalently.
    etherfuseBankAccountId: v.optional(v.union(v.string(), v.null())),
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
      fullName: v.string(),
      cpf: v.string(),
      birthDate: v.string(),
      email: v.string(),
      phone: v.string(),
      termApprovedAt: v.union(v.string(), v.null()),
    }),
  })
    .index("by_publicId", ["publicId"])
    .index("by_status", ["status"])
    .index("by_agency_status", ["agencyId", "status"]),

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

  // Anchor on-ramp orders (e.g. Etherfuse PIX → on-chain USDC). One row per
  // collection attempt; lifecycle moves through transactionStatusValidator.
  anchorOnRampTransactions: defineTable({
    paymentId: v.id("payments"),
    agencyId: v.id("agencies"),
    provider: v.string(),
    providerTransactionId: v.string(),
    providerQuoteId: v.string(),
    status: transactionStatusValidator,
    fromAmount: v.string(),
    fromCurrency: v.string(),
    toAmount: v.string(),
    toCurrency: v.string(),
    stellarAddress: v.string(),
    paymentInstructions: v.optional(v.any()),
    feeBps: v.optional(v.number()),
    stellarTxHash: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_payment", ["paymentId"])
    .index("by_providerTransactionId", ["provider", "providerTransactionId"]),

  // Inbound anchor webhook log. Dedupe on (provider, eventId); the real
  // HMAC-verifying handler in workstream WC enforces idempotency via this
  // index.
  anchorWebhookEvents: defineTable({
    provider: v.string(),
    eventId: v.string(),
    eventType: v.string(),
    payload: v.any(),
    receivedAt: v.string(),
  }).index("by_provider_eventId", ["provider", "eventId"]),

  // Singleton row tracking the latest Horizon paging token seen by the
  // treasury polling action. Inserted lazily on first run.
  stellarIndexState: defineTable({
    sourceAccount: v.string(),
    cursor: v.string(),
    lastRunAt: v.string(),
  }).index("by_sourceAccount", ["sourceAccount"]),
});
