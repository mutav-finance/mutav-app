import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import {
  mutationWithAgencyScope,
  mutationWithAuth,
  queryWithAgencyScope,
  queryWithAuth,
} from "../lib/auth";
import { hashPii } from "../lib/pii";
import type { Result } from "../lib/result";
import {
  AGENCY_TYPE,
  MEMBER_ROLE,
  ONBOARDING_STATE,
  EMPRESA_REQUIRED_DOCS,
  agencyTypeValidator,
  bankingInfoValidator,
  agencyDocumentKindValidator,
  isValidCPF,
  isValidCNPJ,
} from "./domain";
import type { AgencyId, AgencyDocumentKind } from "./domain";

// ─── Result types for mutations ───────────────────────────────────────────────

type StartOnboardingSuccessResult = { agencyId: AgencyId; resumed: boolean };
type StartOnboardingErrorResult = {
  code:
    | "CNPJ_REQUIRED"
    | "CPF_REQUIRED"
    | "CPF_INVALID"
    | "CNPJ_INVALID"
    | "REPRESENTANTE_NAME_REQUIRED"
    | "REPRESENTANTE_CPF_REQUIRED"
    | "REPRESENTANTE_CPF_INVALID"
    | "ALREADY_REGISTERED"
    | "AGENCY_TYPE_CONFLICT";
};

type SaveBankingInfoSuccessResult = { agencyId: AgencyId };
type SaveBankingInfoErrorResult = { code: "NOT_FOUND" | "ONBOARDING_NOT_EDITABLE" };

type GenerateDocumentUploadUrlSuccessResult = { url: string };
type GenerateDocumentUploadUrlErrorResult = { code: "NOT_FOUND" | "ONBOARDING_NOT_EDITABLE" };

type SaveDocumentSuccessResult = { kind: AgencyDocumentKind };
type SaveDocumentErrorResult = { code: "NOT_FOUND" | "ONBOARDING_NOT_EDITABLE" };

type SubmitOnboardingSuccessResult = { agencyId: AgencyId; submittedAt: string };
type SubmitOnboardingErrorResult =
  | {
      code:
        | "NOT_FOUND"
        | "NOT_IN_PROGRESS"
        | "AGENCY_TYPE_REQUIRED"
        | "BANKING_INFO_REQUIRED"
        | "INCOMPLETE_PROFILE"
        | "ALREADY_REGISTERED";
    }
  | { code: "MISSING_DOCUMENTS"; missing: readonly AgencyDocumentKind[] };

// ─── Agency queries ───────────────────────────────────────────────────────────

// Internal — returns the complete agency record (includes CPF, CNPJ, banking).
// Only callable from other Convex functions; never exposed directly to clients.
// Collapses the prior queryWithAgencyScope + getByIdInternal pair: the only
// caller (anchors/actions.ts:onboardAgencyEtherfuseKyb) is itself internalAction,
// so narrowing to a single internalQuery removes the redundant public surface.
export const getById = internalQuery({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    return ctx.db.get(agencyId);
  },
});

// ─── Membership queries ───────────────────────────────────────────────────────

/**
 * Lists the agencies the current user belongs to. Identity is resolved by the
 * wrapper from the JWT subject — no client-side `userId` arg, so a caller can
 * never enumerate another user's memberships.
 */
export const listAgenciesForUser = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();

    const results = await Promise.all(
      memberships.map(async (m) => {
        const agency = await ctx.db.get(m.agencyId);
        if (!agency) return null;
        return { ...agency, role: m.role, membershipId: m._id, joinedAt: m.joinedAt };
      }),
    );

    // Explicit predicate so the array narrows to `NonNullable<…>[]`;
    // `.filter(Boolean)` strips the null at runtime but TypeScript still
    // returns `(T | null)[]`, forcing optional-chains at every callsite.
    return results.filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

// ─── Onboarding queries ───────────────────────────────────────────────────────

/**
 * Lists the agencyDocuments uploaded for an agency. Agency-scoped: the wrapper
 * verifies the caller has membership before the handler runs. Non-members get
 * ForbiddenError rather than the document list.
 */
export const listDocumentsForAgency = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    return ctx.db
      .query("agencyDocuments")
      .withIndex("by_agency", (q) => q.eq("agencyId", ctx.agencyId))
      .collect();
  },
});

/**
 * Returns the onboarding state for the current authenticated user.
 * Used by the post-login routing logic to decide where to send the user:
 *   null / not_started  → /onboarding (start fresh)
 *   in_progress         → /onboarding/wizard (resume)
 *   submitted / under_review → /onboarding/status (waiting for review)
 *   active              → /dashboard (fully onboarded)
 *   rejected            → /onboarding/rejected
 */
export const getMyOnboardingStatus = queryWithAuth({
  args: {},
  handler: async (ctx) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .collect();

    const agencies = await Promise.all(memberships.map((m) => ctx.db.get(m.agencyId)));
    const agency = agencies.find((a) => a !== null) ?? null;
    if (!agency)
      return { state: ONBOARDING_STATE.NOT_STARTED, agencyId: null, rejectionReason: null };

    return {
      state: agency.onboardingState ?? ONBOARDING_STATE.NOT_STARTED,
      agencyId: agency._id,
      rejectionReason: agency.onboardingRejectionReason ?? null,
    };
  },
});

// ─── Onboarding mutations ─────────────────────────────────────────────────────

/**
 * Step 1 — Create the agency record and owner membership.
 * Idempotent: if the user already has an in-progress agency, returns it.
 * Auth-gated — userId is derived from the session, never accepted from client args.
 */
export const startOnboarding = mutationWithAuth({
  args: {
    agencyType: agencyTypeValidator,
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    creci: v.string(),
    cnpj: v.optional(v.string()),
    cpf: v.optional(v.string()),
    representanteName: v.optional(v.string()),
    representanteCpf: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<StartOnboardingSuccessResult, StartOnboardingErrorResult>> => {
    const userId = ctx.user._id;
    // Strip formatting before any check or write — CLAUDE.md convention: store digits-only.
    const cnpj = args.cnpj?.replace(/\D/g, "") || undefined;
    const cpf = args.cpf?.replace(/\D/g, "") || undefined;
    const phone = args.phone.replace(/\D/g, "");
    const representanteCpf = args.representanteCpf?.replace(/\D/g, "") || undefined;

    if (args.agencyType === AGENCY_TYPE.EMPRESA && !cnpj) {
      return {
        success: false,
        error: { code: "CNPJ_REQUIRED" },
        message: "CNPJ is required for empresa agencies",
      };
    }
    if (args.agencyType === AGENCY_TYPE.AUTONOMO && !cpf) {
      return {
        success: false,
        error: { code: "CPF_REQUIRED" },
        message: "CPF is required for autonomo agencies",
      };
    }

    if (cpf && !isValidCPF(cpf)) {
      return { success: false, error: { code: "CPF_INVALID" }, message: "CPF checksum invalid" };
    }
    if (cnpj && !isValidCNPJ(cnpj)) {
      return { success: false, error: { code: "CNPJ_INVALID" }, message: "CNPJ checksum invalid" };
    }

    if (args.agencyType === AGENCY_TYPE.EMPRESA && !args.representanteName?.trim()) {
      return {
        success: false,
        error: { code: "REPRESENTANTE_NAME_REQUIRED" },
        message: "Representative name is required for empresa agencies",
      };
    }
    if (args.agencyType === AGENCY_TYPE.EMPRESA && !representanteCpf) {
      return {
        success: false,
        error: { code: "REPRESENTANTE_CPF_REQUIRED" },
        message: "Representative CPF is required for empresa agencies",
      };
    }
    if (representanteCpf && !isValidCPF(representanteCpf)) {
      return {
        success: false,
        error: { code: "REPRESENTANTE_CPF_INVALID" },
        message: "Representative CPF checksum invalid",
      };
    }

    // Unicidade: IN_PROGRESS não bloqueia — o cadastro só é considerado "ocupado"
    // após submissão. Isso evita bloquear o usuário que reinicia o fluxo com o mesmo CPF/CNPJ.
    if (args.agencyType === AGENCY_TYPE.EMPRESA && cnpj) {
      const existing = await ctx.db
        .query("agencies")
        .withIndex("by_cnpj", (q) => q.eq("cnpj", cnpj))
        .first();
      if (
        existing &&
        existing.onboardingState !== ONBOARDING_STATE.IN_PROGRESS &&
        existing.onboardingState !== ONBOARDING_STATE.REJECTED
      ) {
        return {
          success: false,
          error: { code: "ALREADY_REGISTERED" },
          message: "CNPJ already registered with Mutav",
        };
      }
    }

    if (args.agencyType === AGENCY_TYPE.AUTONOMO && cpf) {
      const existing = await ctx.db
        .query("agencies")
        .withIndex("by_cpf", (q) => q.eq("cpf", cpf))
        .first();
      if (
        existing &&
        existing.onboardingState !== ONBOARDING_STATE.IN_PROGRESS &&
        existing.onboardingState !== ONBOARDING_STATE.REJECTED
      ) {
        return {
          success: false,
          error: { code: "ALREADY_REGISTERED" },
          message: "CPF already registered with Mutav",
        };
      }
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const membership of memberships) {
      const agency = await ctx.db.get(membership.agencyId);
      if (agency?.onboardingState === ONBOARDING_STATE.IN_PROGRESS) {
        // Switching agency type mid-session would corrupt the existing record (different required
        // fields, stale bankingInfo). The user must finish or abandon the current session first.
        if (agency.agencyType !== args.agencyType) {
          return {
            success: false,
            error: { code: "AGENCY_TYPE_CONFLICT" },
            message: "An in-progress registration with a different agency type exists",
          };
        }
        // Resume: apply updated step-1 data so the wizard pre-populates correctly.
        await ctx.db.patch(agency._id, {
          name: args.name,
          email: args.email,
          phone,
          creci: args.creci,
          cnpj,
          cpf,
          agencyType: args.agencyType,
          representanteName: args.representanteName,
          representanteCpf,
        });
        return {
          success: true,
          data: { agencyId: agency._id, resumed: true },
          message: "Resumed existing in-progress registration",
        };
      }
    }

    const now = new Date().toISOString();
    const agencyId = await ctx.db.insert("agencies", {
      name: args.name,
      email: args.email,
      phone,
      creci: args.creci,
      cnpj,
      cpf,
      agencyType: args.agencyType,
      representanteName: args.representanteName,
      representanteCpf,
      onboardingState: ONBOARDING_STATE.IN_PROGRESS,
      createdAt: now,
    });

    await ctx.db.insert("memberships", {
      userId,
      agencyId,
      role: MEMBER_ROLE.OWNER,
      joinedAt: now,
    });

    return { success: true, data: { agencyId, resumed: false }, message: "Onboarding started" };
  },
});

/**
 * Save banking information collected in the banking step. Agency-scoped: the
 * wrapper verifies the caller has membership before the handler runs.
 * Can be called multiple times — last write wins.
 */
export const saveBankingInfo = mutationWithAgencyScope({
  args: {
    bankingInfo: bankingInfoValidator,
  },
  handler: async (
    ctx,
    { bankingInfo },
  ): Promise<Result<SaveBankingInfoSuccessResult, SaveBankingInfoErrorResult>> => {
    const agency = await ctx.db.get(ctx.agencyId);
    if (!agency)
      return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };
    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return {
        success: false,
        error: { code: "ONBOARDING_NOT_EDITABLE" },
        message: "Onboarding is no longer editable",
      };
    }

    await ctx.db.patch(ctx.agencyId, { bankingInfo });
    return { success: true, data: { agencyId: ctx.agencyId }, message: "Banking info saved" };
  },
});

/**
 * Generate a short-lived Convex File Storage upload URL. Agency-scoped: only
 * members can mint upload URLs. Requires the agency to be in IN_PROGRESS state
 * — prevents abusing the endpoint after submission.
 */
export const generateDocumentUploadUrl = mutationWithAgencyScope({
  args: {},
  handler: async (
    ctx,
  ): Promise<
    Result<GenerateDocumentUploadUrlSuccessResult, GenerateDocumentUploadUrlErrorResult>
  > => {
    const agency = await ctx.db.get(ctx.agencyId);
    if (!agency)
      return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };
    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return {
        success: false,
        error: { code: "ONBOARDING_NOT_EDITABLE" },
        message: "Onboarding is no longer editable",
      };
    }
    const url = await ctx.storage.generateUploadUrl();
    return { success: true, data: { url }, message: "Upload URL minted" };
  },
});

/**
 * Persist a document after the client has uploaded it to File Storage.
 * Replaces any existing document of the same kind for this agency. Agency-scoped:
 * only members can register documents under their own agency.
 *
 * Residual risk note: storageId still arrives from the client. A member of agency A
 * could pass a storageId pointing to a file they created outside this flow (e.g.,
 * a separate dev script) and have it recorded as agency A's document. Since members
 * can already upload arbitrary content through the normal flow, this isn't an
 * escalation — but if reviewers want stronger provenance, gate via a pendingUploads
 * token table issued by generateDocumentUploadUrl and consumed here.
 */
export const saveDocument = mutationWithAgencyScope({
  args: {
    kind: agencyDocumentKindValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<Result<SaveDocumentSuccessResult, SaveDocumentErrorResult>> => {
    const agency = await ctx.db.get(ctx.agencyId);
    if (!agency)
      return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };
    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return {
        success: false,
        error: { code: "ONBOARDING_NOT_EDITABLE" },
        message: "Onboarding is no longer editable",
      };
    }

    const duplicate = await ctx.db
      .query("agencyDocuments")
      .withIndex("by_agency_kind", (q) => q.eq("agencyId", ctx.agencyId).eq("kind", args.kind))
      .unique();

    if (duplicate) {
      // Delete file from storage before removing the DB record to avoid orphaned blobs.
      await ctx.storage.delete(duplicate.storageId);
      await ctx.db.delete(duplicate._id);
    }

    await ctx.db.insert("agencyDocuments", {
      agencyId: ctx.agencyId,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName,
      uploadedAt: new Date().toISOString(),
    });

    return { success: true, data: { kind: args.kind }, message: "Document saved" };
  },
});

/**
 * Final step — validate all required fields and transition to `submitted`.
 * For `empresa`: required documents must be uploaded. For `autonomo`: no docs.
 * Agency-scoped: only members can submit their own agency.
 */
export const submitOnboarding = mutationWithAgencyScope({
  args: {
    consentMarketing: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    { consentMarketing },
  ): Promise<Result<SubmitOnboardingSuccessResult, SubmitOnboardingErrorResult>> => {
    const { agencyId } = ctx;
    const agency = await ctx.db.get(agencyId);
    if (!agency)
      return { success: false, error: { code: "NOT_FOUND" }, message: "Agency not found" };

    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return {
        success: false,
        error: { code: "NOT_IN_PROGRESS" },
        message: "Onboarding is not in progress",
      };
    }

    if (!agency.agencyType) {
      return {
        success: false,
        error: { code: "AGENCY_TYPE_REQUIRED" },
        message: "Agency type is required before submission",
      };
    }

    if (!agency.bankingInfo) {
      return {
        success: false,
        error: { code: "BANKING_INFO_REQUIRED" },
        message: "Banking info is required before submission",
      };
    }

    if (
      !agency.name?.trim() ||
      !agency.email?.trim() ||
      !agency.phone?.trim() ||
      !agency.creci?.trim()
    ) {
      return {
        success: false,
        error: { code: "INCOMPLETE_PROFILE" },
        message: "Profile is incomplete — name/email/phone/CRECI required",
      };
    }

    if (agency.agencyType === AGENCY_TYPE.EMPRESA) {
      const documents = await ctx.db
        .query("agencyDocuments")
        .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
        .collect();

      const uploadedKinds = new Set(documents.map((d) => d.kind));
      const missing = EMPRESA_REQUIRED_DOCS.filter((k) => !uploadedKinds.has(k));

      if (missing.length > 0) {
        return {
          success: false,
          error: { code: "MISSING_DOCUMENTS", missing },
          message: `Missing required documents: ${missing.join(", ")}`,
        };
      }
    }

    // Claim the national document via its HMAC sidecar. Two concurrent
    // submissions for the same CPF/CNPJ race on the by_documentHash read
    // set; Convex OCC serializes the inserts, the loser retries and the
    // retry observes the existing row and exits via ALREADY_REGISTERED.
    // Replaces the prior agency-row scan, which couldn't catch the race
    // because the patches targeted distinct rows.
    const document = agency.agencyType === AGENCY_TYPE.AUTONOMO ? agency.cpf : agency.cnpj;
    if (document) {
      const documentHash = await hashPii(document);
      const existingClaim = await ctx.db
        .query("claimedDocuments")
        .withIndex("by_documentHash", (q) => q.eq("documentHash", documentHash))
        .first();
      if (existingClaim && existingClaim.agencyId !== agencyId) {
        return {
          success: false,
          error: { code: "ALREADY_REGISTERED" },
          message: "Document already registered with another agency",
        };
      }
      if (!existingClaim) {
        await ctx.db.insert("claimedDocuments", {
          documentHash,
          agencyId,
          claimedAt: new Date().toISOString(),
        });
      }
    }

    const submittedAt = new Date().toISOString();
    await ctx.db.patch(agencyId, {
      onboardingState: ONBOARDING_STATE.SUBMITTED,
      onboardingSubmittedAt: submittedAt,
      consentMarketing: consentMarketing ?? false,
    });

    return {
      success: true,
      data: { agencyId, submittedAt },
      message: "Onboarding submitted for review",
    };
  },
});
