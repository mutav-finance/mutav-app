import { v } from "convex/values";
import { internalQuery, query, mutation } from "../_generated/server";
import { queryWithAgencyScope, queryWithAuth } from "../lib/auth";
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

// ─── Agency queries ───────────────────────────────────────────────────────────

/**
 * Fetch one agency by id. The wrapper asserts the caller is a member of the
 * requested agency before the handler runs — non-members get
 * `ForbiddenError` rather than the agency doc.
 */
export const getById = queryWithAgencyScope({
  args: {},
  handler: async (ctx) => {
    return ctx.db.get(ctx.agencyId);
  },
});

/**
 * Internal companion to `getById` for use from actions/schedulers where
 * caller identity may not propagate. The calling internal flow is
 * responsible for whatever authorization is appropriate at its entry point.
 */
export const getByIdInternal = internalQuery({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    return ctx.db.get(agencyId);
  },
});

// ─── Membership queries ───────────────────────────────────────────────────────

/**
 * Lists the agencies the current user belongs to. Identity is resolved by the
 * wrapper (pre-Auth0: `dev-user`; post-Auth0: JWT subject) — no client-side
 * `userId` arg, so a caller can never enumerate another user's memberships.
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

    return results.filter(Boolean);
  },
});

/** Returns all members of an agency, each enriched with their user info and role. */
export const listMembersForAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_agency", (q) => q.eq("agencyId", args.agencyId))
      .collect();

    const results = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        if (!user) return null;
        return { ...user, role: m.role, membershipId: m._id, joinedAt: m.joinedAt };
      }),
    );

    return results.filter(Boolean);
  },
});

/** Returns a single membership for a user↔agency pair. */
export const getMembership = query({
  args: { userId: v.id("users"), agencyId: v.id("agencies") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("memberships")
      .withIndex("by_user_agency", (q) => q.eq("userId", args.userId).eq("agencyId", args.agencyId))
      .unique();
  },
});

// ─── Onboarding queries ───────────────────────────────────────────────────────

export const listDocumentsForAgency = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    return ctx.db
      .query("agencyDocuments")
      .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
      .collect();
  },
});

/**
 * Returns the in-progress onboarding agency for a user, if any.
 * Used by the wizard to restore a partially-filled session.
 * TODO(auth): replace userId arg with requireIdentity(ctx).
 */
export const getOnboardingInProgress = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const agencies = await Promise.all(memberships.map((m) => ctx.db.get(m.agencyId)));
    const inProgress = agencies.find((a) => a?.onboardingState === ONBOARDING_STATE.IN_PROGRESS);
    if (!inProgress) return null;

    const documents = await ctx.db
      .query("agencyDocuments")
      .withIndex("by_agency", (q) => q.eq("agencyId", inProgress._id))
      .collect();

    return { agency: inProgress, documents };
  },
});

/**
 * Returns the current onboarding state of an agency.
 * TODO(auth): require identity + verify ownership.
 */
export const getOnboardingStatus = query({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    const agency = await ctx.db.get(agencyId);
    if (!agency) return null;
    return {
      agencyId: agency._id,
      onboardingState: agency.onboardingState ?? ONBOARDING_STATE.NOT_STARTED,
      onboardingSubmittedAt: agency.onboardingSubmittedAt ?? null,
      onboardingRejectionReason: agency.onboardingRejectionReason ?? null,
    };
  },
});

// ─── Onboarding mutations ─────────────────────────────────────────────────────

/**
 * Step 1 — Create the agency record and owner membership.
 * Idempotent: if the user already has an in-progress agency, returns it.
 * TODO(auth): replace userId arg with requireIdentity(ctx).
 */
export const startOnboarding = mutation({
  args: {
    userId: v.id("users"),
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
  handler: async (ctx, args) => {
    // Strip formatting before any check or write — CLAUDE.md convention: store digits-only.
    const cnpj = args.cnpj?.replace(/\D/g, "") || undefined;
    const cpf = args.cpf?.replace(/\D/g, "") || undefined;
    const phone = args.phone.replace(/\D/g, "");
    const representanteCpf = args.representanteCpf?.replace(/\D/g, "") || undefined;

    if (args.agencyType === AGENCY_TYPE.EMPRESA && !cnpj) {
      return { success: false, error: { code: "CNPJ_REQUIRED" } } as const;
    }
    if (args.agencyType === AGENCY_TYPE.AUTONOMO && !cpf) {
      return { success: false, error: { code: "CPF_REQUIRED" } } as const;
    }

    if (cpf && !isValidCPF(cpf)) {
      return { success: false, error: { code: "CPF_INVALID" } } as const;
    }
    if (cnpj && !isValidCNPJ(cnpj)) {
      return { success: false, error: { code: "CNPJ_INVALID" } } as const;
    }

    if (args.agencyType === AGENCY_TYPE.EMPRESA && !args.representanteName?.trim()) {
      return { success: false, error: { code: "REPRESENTANTE_NAME_REQUIRED" } } as const;
    }
    if (args.agencyType === AGENCY_TYPE.EMPRESA && !representanteCpf) {
      return { success: false, error: { code: "REPRESENTANTE_CPF_REQUIRED" } } as const;
    }
    if (representanteCpf && !isValidCPF(representanteCpf)) {
      return { success: false, error: { code: "REPRESENTANTE_CPF_INVALID" } } as const;
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
        return { success: false, error: { code: "ALREADY_REGISTERED" } } as const;
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
        return { success: false, error: { code: "ALREADY_REGISTERED" } } as const;
      }
    }

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    for (const membership of memberships) {
      const agency = await ctx.db.get(membership.agencyId);
      if (agency?.onboardingState === ONBOARDING_STATE.IN_PROGRESS) {
        // Switching agency type mid-session would corrupt the existing record (different required
        // fields, stale bankingInfo). The user must finish or abandon the current session first.
        if (agency.agencyType !== args.agencyType) {
          return { success: false, error: { code: "AGENCY_TYPE_CONFLICT" } } as const;
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
        return { success: true, data: { agencyId: agency._id, resumed: true } } as const;
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
      onboardingSubmittedAt: null,
      createdAt: now,
    });

    await ctx.db.insert("memberships", {
      userId: args.userId,
      agencyId,
      role: MEMBER_ROLE.OWNER,
      joinedAt: now,
    });

    return { success: true, data: { agencyId, resumed: false } } as const;
  },
});

/**
 * Save banking information collected in the banking step.
 * Can be called multiple times — last write wins.
 * TODO(auth): require identity + verify ownership.
 */
export const saveBankingInfo = mutation({
  args: {
    agencyId: v.id("agencies"),
    bankingInfo: bankingInfoValidator,
  },
  handler: async (ctx, { agencyId, bankingInfo }) => {
    const agency = await ctx.db.get(agencyId);
    if (!agency) return { success: false, error: { code: "NOT_FOUND" } } as const;
    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return { success: false, error: { code: "ONBOARDING_NOT_EDITABLE" } } as const;
    }

    await ctx.db.patch(agencyId, { bankingInfo });
    return { success: true, data: { agencyId } } as const;
  },
});

/**
 * Generate a short-lived Convex File Storage upload URL.
 * The client uploads the file directly, then calls saveDocument with the storageId.
 * Requires the agency to be in IN_PROGRESS state — prevents unauthenticated storage abuse.
 * TODO(auth): require identity + verify ownership of agencyId.
 */
export const generateDocumentUploadUrl = mutation({
  args: { agencyId: v.id("agencies") },
  handler: async (ctx, { agencyId }) => {
    const agency = await ctx.db.get(agencyId);
    if (!agency) return { success: false, error: { code: "NOT_FOUND" } } as const;
    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return { success: false, error: { code: "ONBOARDING_NOT_EDITABLE" } } as const;
    }
    const url = await ctx.storage.generateUploadUrl();
    return { success: true, data: { url } } as const;
  },
});

/**
 * Persist a document after the client has uploaded it to File Storage.
 * Replaces any existing document of the same kind for this agency.
 * TODO(auth): require identity + verify ownership.
 */
export const saveDocument = mutation({
  args: {
    agencyId: v.id("agencies"),
    kind: agencyDocumentKindValidator,
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, args) => {
    const agency = await ctx.db.get(args.agencyId);
    if (!agency) return { success: false, error: { code: "NOT_FOUND" } } as const;
    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return { success: false, error: { code: "ONBOARDING_NOT_EDITABLE" } } as const;
    }

    const duplicate = await ctx.db
      .query("agencyDocuments")
      .withIndex("by_agency_kind", (q) => q.eq("agencyId", args.agencyId).eq("kind", args.kind))
      .unique();

    if (duplicate) {
      // Delete file from storage before removing the DB record to avoid orphaned blobs.
      await ctx.storage.delete(duplicate.storageId);
      await ctx.db.delete(duplicate._id);
    }

    await ctx.db.insert("agencyDocuments", {
      agencyId: args.agencyId,
      kind: args.kind,
      storageId: args.storageId,
      fileName: args.fileName,
      uploadedAt: new Date().toISOString(),
    });

    return { success: true, data: { kind: args.kind } } as const;
  },
});

/**
 * Final step — validate all required fields and transition to `submitted`.
 * For `empresa`: all 4 documents must be uploaded.
 * For `autonomo`: no documents required.
 * TODO(auth): require identity + verify ownership.
 */
export const submitOnboarding = mutation({
  args: {
    agencyId: v.id("agencies"),
    consentMarketing: v.optional(v.boolean()),
  },
  handler: async (ctx, { agencyId, consentMarketing }) => {
    const agency = await ctx.db.get(agencyId);
    if (!agency) return { success: false, error: { code: "NOT_FOUND" } } as const;

    if (agency.onboardingState !== ONBOARDING_STATE.IN_PROGRESS) {
      return { success: false, error: { code: "NOT_IN_PROGRESS" } } as const;
    }

    if (!agency.agencyType) {
      return { success: false, error: { code: "AGENCY_TYPE_REQUIRED" } } as const;
    }

    if (!agency.bankingInfo) {
      return { success: false, error: { code: "BANKING_INFO_REQUIRED" } } as const;
    }

    if (
      !agency.name?.trim() ||
      !agency.email?.trim() ||
      !agency.phone?.trim() ||
      !agency.creci?.trim()
    ) {
      return { success: false, error: { code: "INCOMPLETE_PROFILE" } } as const;
    }

    // Garante unicidade de CPF/CNPJ no momento da submissão — é aqui que o cadastro
    // se torna "ocupado". Dois usuários podem estar IN_PROGRESS com o mesmo documento,
    // mas apenas o primeiro a submeter passa.
    if (agency.agencyType === AGENCY_TYPE.AUTONOMO && agency.cpf) {
      const cpf = agency.cpf;
      const existing = await ctx.db
        .query("agencies")
        .withIndex("by_cpf", (q) => q.eq("cpf", cpf))
        .first();
      if (
        existing &&
        existing._id !== agencyId &&
        existing.onboardingState !== ONBOARDING_STATE.REJECTED &&
        existing.onboardingState !== ONBOARDING_STATE.IN_PROGRESS
      ) {
        return { success: false, error: { code: "ALREADY_REGISTERED" } } as const;
      }
    }

    if (agency.agencyType === AGENCY_TYPE.EMPRESA && agency.cnpj) {
      const cnpj = agency.cnpj;
      const existing = await ctx.db
        .query("agencies")
        .withIndex("by_cnpj", (q) => q.eq("cnpj", cnpj))
        .first();
      if (
        existing &&
        existing._id !== agencyId &&
        existing.onboardingState !== ONBOARDING_STATE.REJECTED &&
        existing.onboardingState !== ONBOARDING_STATE.IN_PROGRESS
      ) {
        return { success: false, error: { code: "ALREADY_REGISTERED" } } as const;
      }
    }

    if (agency.agencyType === AGENCY_TYPE.EMPRESA) {
      const documents = await ctx.db
        .query("agencyDocuments")
        .withIndex("by_agency", (q) => q.eq("agencyId", agencyId))
        .collect();

      const uploadedKinds = new Set(documents.map((d) => d.kind));
      const missing = EMPRESA_REQUIRED_DOCS.filter((k) => !uploadedKinds.has(k));

      if (missing.length > 0) {
        return { success: false, error: { code: "MISSING_DOCUMENTS", missing } } as const;
      }
    }

    const submittedAt = new Date().toISOString();
    await ctx.db.patch(agencyId, {
      onboardingState: ONBOARDING_STATE.SUBMITTED,
      onboardingSubmittedAt: submittedAt,
      consentMarketing: consentMarketing ?? false,
    });

    return { success: true, data: { agencyId, submittedAt } } as const;
  },
});
