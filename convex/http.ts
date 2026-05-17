import canonicalize from "canonicalize";
import { httpRouter } from "convex/server";

import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getEtherfuseWebhookSecret } from "./lib/env";

const http = httpRouter();

type EtherfuseWebhookPayload = {
  id?: string;
  eventId?: string;
  type?: string;
  eventType?: string;
  order?: { id?: string; status?: string };
  data?: { id?: string; status?: string };
} & Record<string, unknown>;

// HTTP actions run in Convex's V8 runtime which doesn't expose
// node:crypto. Use the Web Crypto API and atob+TextEncoder for the same
// HMAC-SHA256-over-canonicalized-JSON scheme Etherfuse documents at
// docs.etherfuse.com/guides/verifying-webhooks.

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifyEtherfuseSignature(
  parsedBody: unknown,
  signatureHeader: string | null,
  secretBase64: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const canonical = canonicalize(parsedBody);
  if (canonical === undefined) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(secretBase64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  const expected = `sha256=${toHex(sigBuffer)}`;
  return constantTimeEqualBytes(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(signatureHeader),
  );
}

function extractEventId(payload: EtherfuseWebhookPayload): string | null {
  return payload.id ?? payload.eventId ?? null;
}

function extractEventType(payload: EtherfuseWebhookPayload): string {
  return payload.type ?? payload.eventType ?? "unknown";
}

http.route({
  path: "/etherfuse-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    let parsed: EtherfuseWebhookPayload;
    try {
      // External API boundary; structure validated below.
      parsed = JSON.parse(rawBody) as EtherfuseWebhookPayload;
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    const signatureHeader = request.headers.get("x-signature");
    const valid = await verifyEtherfuseSignature(
      parsed,
      signatureHeader,
      getEtherfuseWebhookSecret(),
    );
    if (!valid) {
      return new Response("bad signature", { status: 401 });
    }

    const eventId = extractEventId(parsed);
    if (!eventId) {
      // No id means we can't dedupe — accept once but log so ops can audit.
      console.warn("[etherfuse-webhook] event without id, processing without dedupe", parsed);
    }

    const eventType = extractEventType(parsed);
    const dedupe = await ctx.runMutation(internal.anchors.webhookUseCases.recordWebhookEvent, {
      provider: "etherfuse",
      eventId: eventId ?? `no-id:${Date.now()}`,
      eventType,
      payload: parsed,
    });
    if (dedupe.alreadyProcessed) {
      return new Response("duplicate, ignored", { status: 200 });
    }

    // For PR-5 we only act on order_updated events. Other event types
    // (customer_updated, kyc_updated, etc.) get logged but not processed —
    // the followup webhook semantics are PR-6+ scope.
    if (eventType === "order_updated") {
      const orderExternalId = parsed.order?.id ?? parsed.data?.id;
      if (orderExternalId) {
        const order = await ctx.runQuery(internal.anchors.orderUseCases.getByAnchorTxId, {
          anchorTxId: orderExternalId,
        });
        if (!order) {
          // No matching local row — webhook arrived before we persisted, or
          // it's for an order from a different deployment. Stamp processed
          // so a retry doesn't keep re-running this lookup; ack so
          // Etherfuse doesn't retry forever.
          console.warn(`[etherfuse-webhook] no local order for ${orderExternalId}`);
          await ctx.runMutation(internal.anchors.webhookUseCases.markWebhookEventProcessed, {
            eventRowId: dedupe.eventRowId,
          });
          return new Response("ok (no local order)", { status: 200 });
        }
        // pollPixOnramp re-fetches canonical state from Etherfuse and runs
        // the existing normalize → markPaid flow. We delegate rather than
        // trusting the webhook payload's status directly — the webhook can
        // be stale by the time it lands. If this throws we deliberately
        // DO NOT mark processed — the next retry will reprocess.
        await ctx.runAction(api.anchors.actions.pollPixOnramp, {
          orderId: order._id,
        });
      }
    }

    await ctx.runMutation(internal.anchors.webhookUseCases.markWebhookEventProcessed, {
      eventRowId: dedupe.eventRowId,
    });
    return new Response("ok", { status: 200 });
  }),
});

export default http;
