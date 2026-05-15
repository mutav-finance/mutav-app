"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import { EtherfuseClient } from "../../src/lib/anchors/etherfuse/client";
import type { Result } from "../../src/lib/result";
import { getEtherfuseApiKey, getEtherfuseBaseUrl, getMutavSourceAccount } from "../lib/env";
import { derivePaymentMuxedAddress } from "../payments/lib/muxedAddress";
import { ANCHOR_ERROR_CODE, ANCHOR_PROVIDER } from "./domain";

type AnchorErrorPayload = { code: string };

function getEtherfuseClient(): EtherfuseClient {
  return new EtherfuseClient({
    apiKey: getEtherfuseApiKey(),
    baseUrl: getEtherfuseBaseUrl(),
  });
}

/**
 * Provision the Etherfuse child organization (business KYB) for an agency.
 *
 * The agency's Stellar settlement wallet is the Mutav treasury G-address —
 * TESOURO minted by Etherfuse arrives at the treasury, and the per-payment
 * muxed M-address is what distinguishes invoices. Result is idempotent: if
 * the agency already has an `etherfuseOrgId`, returns it without re-calling
 * the API.
 *
 * v0 auth: `actingUserPublicId` is a placeholder string; impersonation is
 * not yet prevented. The follow-up to wire `ctx.auth.getUserIdentity()`
 * lives in `.claude/notes/deferred-conventions.md`.
 */
export const onboardAgency = action({
  args: {
    agencyId: v.id("agencies"),
    actingUserPublicId: v.string(),
  },
  handler: async (
    ctx,
    { agencyId },
  ): Promise<Result<{ etherfuseOrgId: string }, AnchorErrorPayload>> => {
    const agency = await ctx.runQuery(api.agencies.useCases.getById, { agencyId });
    if (!agency) {
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.AGENCY_NOT_FOUND },
        message: "Agency not found",
      };
    }

    if (agency.etherfuseOrgId) {
      return {
        success: true,
        data: { etherfuseOrgId: agency.etherfuseOrgId },
        message: "Agency already onboarded",
      };
    }

    const client = getEtherfuseClient();
    const treasuryPublicKey = getMutavSourceAccount();

    try {
      const customer = await client.createCustomer({
        country: "BR",
        publicKey: treasuryPublicKey,
        name: agency.name,
      });

      await ctx.runMutation(internal.agencies.useCases.updateEtherfuseStatus, {
        agencyId,
        status: "pending",
        etherfuseOrgId: customer.id,
      });

      return {
        success: true,
        data: { etherfuseOrgId: customer.id },
        message: "Onboarding started",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.ORDER_FAILED },
        message,
      };
    }
  },
});

/**
 * Open an Etherfuse on-ramp order for a pending/overdue payment.
 *
 * Sequence: validate payment + agency → derive the per-payment muxed
 * M-address → request a BRL→TESOURO quote → create the order → persist the
 * row → patch `payments.method` to the `pix_anchor` variant carrying the
 * PIX BR-Code and expiry. The webhook handler in WC takes it from there.
 */
export const createPaymentOrder = action({
  args: { paymentId: v.id("payments") },
  handler: async (
    ctx,
    { paymentId },
  ): Promise<
    Result<{ onRampTransactionId: string; pixCode: string; expiresAt: string }, AnchorErrorPayload>
  > => {
    const payment = await ctx.runQuery(api.payments.useCases.getById, { paymentId });
    if (!payment) {
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.PAYMENT_NOT_FOUND },
        message: "Payment not found",
      };
    }
    if (!payment.muxedId) {
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.PAYMENT_MUXED_ID_MISSING },
        message: "Payment is missing muxedId",
      };
    }
    if (payment.state.kind !== "pending" && payment.state.kind !== "overdue") {
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.PAYMENT_NOT_CHARGEABLE },
        message: `Payment state is "${payment.state.kind}"`,
      };
    }

    const agency = await ctx.runQuery(api.agencies.useCases.getById, {
      agencyId: payment.agencyId,
    });
    if (!agency || !agency.etherfuseOrgId || agency.etherfuseOnboardingStatus !== "approved") {
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.AGENCY_NOT_ONBOARDED },
        message: "Agency is not approved for Etherfuse on-ramp",
      };
    }

    const mAddress = derivePaymentMuxedAddress(payment.muxedId);
    const client = getEtherfuseClient();

    try {
      const quote = await client.getQuote({
        fromCurrency: "BRL",
        toCurrency: "TESOURO",
        fromAmount: (payment.totalCents / 100).toFixed(2),
        customerId: agency.etherfuseOrgId,
        stellarAddress: mAddress,
      });

      const onRamp = await client.createOnRamp({
        customerId: agency.etherfuseOrgId,
        quoteId: quote.id,
        stellarAddress: mAddress,
        fromCurrency: "BRL",
        toCurrency: "TESOURO",
        amount: quote.fromAmount,
      });

      const onRampRowId = await ctx.runMutation(internal.anchors.useCases.insertOnRampTransaction, {
        paymentId,
        agencyId: payment.agencyId,
        provider: ANCHOR_PROVIDER.ETHERFUSE,
        providerTransactionId: onRamp.id,
        providerQuoteId: quote.id,
        status: onRamp.status,
        fromAmount: onRamp.fromAmount,
        fromCurrency: onRamp.fromCurrency || "BRL",
        toAmount: onRamp.toAmount,
        toCurrency: onRamp.toCurrency || "TESOURO",
        stellarAddress: onRamp.stellarAddress || mAddress,
        paymentInstructions: onRamp.paymentInstructions,
        feeBps: onRamp.feeBps,
      });

      if (
        !onRamp.paymentInstructions ||
        onRamp.paymentInstructions.type !== "pix" ||
        !onRamp.paymentInstructions.pixCode
      ) {
        return {
          success: false,
          error: { code: ANCHOR_ERROR_CODE.ORDER_FAILED },
          message: "Etherfuse order did not include PIX payment instructions",
        };
      }

      const pixCode = onRamp.paymentInstructions.pixCode;
      const expiresAt = quote.expiresAt;

      await ctx.runMutation(internal.anchors.useCases.setPaymentMethodToPixAnchor, {
        paymentId,
        anchorOnRampTransactionId: onRampRowId,
        pixCode,
        expiresAt,
      });

      return {
        success: true,
        data: { onRampTransactionId: onRampRowId, pixCode, expiresAt },
        message: "Order created",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: { code: ANCHOR_ERROR_CODE.ORDER_FAILED },
        message,
      };
    }
  },
});
