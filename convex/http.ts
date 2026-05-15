import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

/**
 * TEMPORARY anchor webhook stub.
 *
 * Returns 200 OK unconditionally so we can register this URL with the
 * Etherfuse sandbox and capture the per-webhook signing secret. The real
 * handler — HMAC verification against ETHERFUSE_WEBHOOK_SECRET, dedupe via
 * the anchorWebhookEvents.by_provider_eventId index, and dispatch into
 * payments/anchor state machines — lands in workstream WC.
 *
 * Do NOT trust anything this endpoint receives. It only logs.
 */
http.route({
  path: "/anchors/webhook",
  method: "POST",
  handler: httpAction(async (_ctx, req) => {
    const body = await req.text();
    console.log("[anchors/webhook STUB] received", { body });
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }),
});

export default http;
