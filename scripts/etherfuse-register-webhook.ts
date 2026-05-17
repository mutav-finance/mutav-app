/**
 * Register a webhook URL with Etherfuse for the current sandbox API key.
 *
 * Usage:
 *
 *   bun scripts/etherfuse-register-webhook.ts https://<deployment>.convex.site/etherfuse-webhook
 *
 * Etherfuse returns the signing secret exactly ONCE on registration —
 * paste it into Convex with:
 *
 *   bunx convex env set ETHERFUSE_WEBHOOK_SECRET <returned-secret>
 *
 * Then start `bunx convex dev` and the /etherfuse-webhook route will
 * verify signatures against that secret.
 *
 * Env vars consumed:
 *   ETHERFUSE_API_KEY  (required; same key the app uses)
 *   ETHERFUSE_BASE_URL (optional; defaults to https://api.sand.etherfuse.com)
 */

import { randomUUID } from "node:crypto";

const EVENT_TYPE = "order_updated";

const apiKey = process.env.ETHERFUSE_API_KEY;
const baseUrl = process.env.ETHERFUSE_BASE_URL ?? "https://api.sand.etherfuse.com";
const webhookUrl = process.argv[2];

if (!apiKey) {
  console.error("ETHERFUSE_API_KEY env var is required.");
  process.exit(1);
}
if (!webhookUrl) {
  console.error("Usage: bun scripts/etherfuse-register-webhook.ts <https-url>");
  process.exit(1);
}

const webhookId = randomUUID();
const body = JSON.stringify({ id: webhookId, eventType: EVENT_TYPE, url: webhookUrl });

console.log(`POST ${baseUrl}/ramp/webhook`);
console.log(`  webhookId : ${webhookId}`);
console.log(`  eventType : ${EVENT_TYPE}`);
console.log(`  url       : ${webhookUrl}`);
console.log();

const response = await fetch(`${baseUrl}/ramp/webhook`, {
  method: "POST",
  headers: {
    Authorization: apiKey,
    "Content-Type": "application/json",
  },
  body,
});

const text = await response.text();
if (!response.ok) {
  console.error(`✗ HTTP ${response.status}: ${text}`);
  process.exit(1);
}

// External API boundary — schema validated by checks below.
const parsed = JSON.parse(text) as { id?: string; secret?: string };
if (!parsed.secret) {
  console.error("✗ Response missing `secret` — webhook will fail signature verification.");
  console.error("  Raw:", text);
  process.exit(1);
}

console.log("✓ Registered. Secret (only returned once):");
console.log();
console.log(`  ${parsed.secret}`);
console.log();
console.log("Set in Convex deployment env:");
console.log();
console.log(`  bunx convex env set ETHERFUSE_WEBHOOK_SECRET ${parsed.secret}`);
