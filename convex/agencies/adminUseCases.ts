import { v } from "convex/values";
import { internalQuery, internalMutation } from "../_generated/server";
import { ONBOARDING_STATE } from "./domain";

// ─── KYC / KYB review — funções internas para o admin dashboard ───────────────
//
// Todas as funções aqui são `internal*` — nunca expostas diretamente ao cliente.
// O admin dashboard vai chamá-las através de actions/mutations públicas
// gateadas por auth de staff (a implementar junto com o Auth0).

/**
 * Lista todas as agências aguardando revisão (submitted + under_review),
 * cada uma enriquecida com seus documentos enviados.
 */
export const getPendingReviews = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [submitted, underReview] = await Promise.all([
      ctx.db
        .query("agencies")
        .withIndex("by_onboardingState", (q) => q.eq("onboardingState", ONBOARDING_STATE.SUBMITTED))
        .collect(),
      ctx.db
        .query("agencies")
        .withIndex("by_onboardingState", (q) =>
          q.eq("onboardingState", ONBOARDING_STATE.UNDER_REVIEW),
        )
        .collect(),
    ]);

    const agencies = [...submitted, ...underReview];

    return Promise.all(
      agencies.map(async (agency) => {
        const documents = await ctx.db
          .query("agencyDocuments")
          .withIndex("by_agency", (q) => q.eq("agencyId", agency._id))
          .collect();
        return { ...agency, documents };
      }),
    );
  },
});

/**
 * Gera uma URL temporária (curta duração) para download de um documento KYC.
 * Retorna null se o arquivo não existir no storage.
 */
export const generateDocumentDownloadUrl = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    return ctx.storage.getUrl(storageId);
  },
});

/**
 * Aprova ou rejeita uma submissão de onboarding.
 * - approved: transiciona para `active` — agência liberada para operar
 * - rejected: transiciona para `rejected` + persiste o motivo para exibição ao solicitante
 *
 * Aceita agências nos estados `submitted` ou `under_review`.
 */
export const reviewOnboarding = internalMutation({
  args: {
    agencyId: v.id("agencies"),
    decision: v.union(v.literal("approved"), v.literal("rejected")),
    rejectionReason: v.optional(v.string()),
  },
  handler: async (ctx, { agencyId, decision, rejectionReason }) => {
    const agency = await ctx.db.get(agencyId);
    if (!agency) return { success: false, error: { code: "NOT_FOUND" } } as const;

    const reviewableStates = [ONBOARDING_STATE.SUBMITTED, ONBOARDING_STATE.UNDER_REVIEW];
    if (!reviewableStates.includes(agency.onboardingState as (typeof reviewableStates)[number])) {
      return { success: false, error: { code: "NOT_REVIEWABLE" } } as const;
    }

    const reviewedAt = new Date().toISOString();

    if (decision === "approved") {
      await ctx.db.patch(agencyId, { onboardingState: ONBOARDING_STATE.ACTIVE });
    } else {
      await ctx.db.patch(agencyId, {
        onboardingState: ONBOARDING_STATE.REJECTED,
        onboardingRejectionReason: rejectionReason,
      });
    }

    return { success: true, data: { agencyId, decision, reviewedAt } } as const;
  },
});
