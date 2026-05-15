import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { ANCHOR_PROVIDER } from "./anchors/domain";
import {
  deriveEventId,
  etherfuseWebhookPayloadSchema,
  verifyEtherfuseSignature,
} from "./anchors/webhook";
import { getEtherfuseWebhookSecret } from "./lib/env";

const http = httpRouter();

/**
 * Etherfuse webhook receiver.
 *
 * Sequence (each step is a hard gate for the next):
 *   1. Read raw body BEFORE parsing — HMAC is computed over raw bytes.
 *   2. Verify `X-Signature: sha256=<hex>` against ETHERFUSE_WEBHOOK_SECRET.
 *   3. JSON.parse + Zod-validate the tagged-union payload.
 *   4. Derive a composite event id and dedupe via
 *      `anchorWebhookEvents.by_provider_eventId`.
 *   5. Insert the raw event for audit.
 *   6. Dispatch:
 *        - `kyc_updated` → `agencies.updateEtherfuseStatus`
 *        - `order_updated` → `anchors.updateOnRampTransactionStatus`
 *
 * The OpenAPI spec does not document a webhook timestamp header, so this
 * handler does not enforce the 5-minute staleness gate the original plan
 * called for. Replay protection still holds via the composite event-id
 * dedupe (every `(provider, eventId)` pair is unique and inserted only once).
 *
 * Settlement remains primarily owned by the Horizon watcher
 * (`payments/actions.ts:checkMutavTreasuryPayments`); this webhook is the
 * redundant path. Both write through `markPaidByTx` which is idempotent on
 * `txHash`.
 */
http.route({
  path: "/anchors/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();

    const signature = request.headers.get("X-Signature");
    const secret = getEtherfuseWebhookSecret();
    const valid = await verifyEtherfuseSignature(rawBody, signature, secret);
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }

    let payload: ReturnType<typeof etherfuseWebhookPayloadSchema.parse>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      payload = etherfuseWebhookPayloadSchema.parse(parsed);
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }

    const eventInfo = deriveEventId(payload);
    if (!eventInfo) {
      // Event type we don't act on (customer/bank/swap/quote); ack and move on.
      return new Response("OK", { status: 200 });
    }

    const existing = await ctx.runQuery(internal.anchors.useCases.findWebhookEventById, {
      provider: ANCHOR_PROVIDER.ETHERFUSE,
      eventId: eventInfo.eventId,
    });
    if (existing) {
      return new Response("OK (replay)", { status: 200 });
    }

    await ctx.runMutation(internal.anchors.useCases.insertWebhookEvent, {
      provider: ANCHOR_PROVIDER.ETHERFUSE,
      eventId: eventInfo.eventId,
      eventType: eventInfo.eventType,
      payload,
    });

    if (payload.kyc_updated) {
      const k = payload.kyc_updated;
      const agency = await ctx.runQuery(internal.agencies.useCases.findAgencyByEtherfuseOrgId, {
        etherfuseOrgId: k.customerId,
      });
      if (agency) {
        await ctx.runMutation(internal.agencies.useCases.updateEtherfuseStatus, {
          agencyId: agency._id,
          status: mapEtherfuseKycStatus(k.status),
        });
      }
    }

    if (payload.order_updated) {
      const o = payload.order_updated;
      const anchorRow = await ctx.runQuery(internal.anchors.useCases.findOnRampByProviderTxId, {
        provider: ANCHOR_PROVIDER.ETHERFUSE,
        providerTransactionId: o.orderId,
      });
      if (anchorRow) {
        const status = mapEtherfuseOrderStatus(o.status);
        await ctx.runMutation(internal.anchors.useCases.updateOnRampTransactionStatus, {
          id: anchorRow._id,
          status,
          ...(o.confirmedTxSignature ? { stellarTxHash: o.confirmedTxSignature } : {}),
        });
      }
    }

    return new Response("OK", { status: 200 });
  }),
});

export default http;

// ─── Status mapping helpers ──────────────────────────────────────────────────
//
// Etherfuse status enums are slightly broader than ours (e.g. `proposed`,
// `approved_chain_deploying`); collapse to our domain unions defensively.

type AgencyKycStatus = "not_started" | "pending" | "approved" | "rejected" | "update_required";

function mapEtherfuseKycStatus(etherfuse: string): AgencyKycStatus {
  switch (etherfuse.toLowerCase()) {
    case "approved":
    case "approved_chain_deploying":
      return "approved";
    case "rejected":
      return "rejected";
    case "update_required":
      return "update_required";
    case "not_started":
      return "not_started";
    case "pending":
    case "proposed":
    case "in_review":
      return "pending";
    default:
      return "pending";
  }
}

type OnRampStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded";

function mapEtherfuseOrderStatus(etherfuse: string): OnRampStatus {
  switch (etherfuse.toLowerCase()) {
    case "created":
      return "pending";
    case "funded":
    case "processing":
      return "processing";
    case "completed":
    case "finalized":
      return "completed";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "refunded":
      return "refunded";
    default:
      return "processing";
  }
}
