import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";

const WEBHOOK_SECRET_PATH = ".data/etherfuse-webhook.json";
const EVENT_TYPE = "order_updated";
const WEBHOOK_PATH = "/webhooks/etherfuse";

type CreateWebhookResponse = {
  id: string;
  url: string;
  eventType: string;
  secret: string;
  createdAt: string;
};

const ngrokBase = Bun.argv[2];
if (!ngrokBase) {
  console.error("Usage: bun run 2:webhook:register <ngrok-base-url>");
  console.error();
  console.error("Example workflow:");
  console.error("  1. Terminal A: ngrok http 3000");
  console.error("     copy the https forwarding URL (e.g. https://abc123.ngrok-free.app)");
  console.error(`  2. Terminal B: bun run 2:webhook:register https://abc123.ngrok-free.app`);
  console.error("  3. Terminal C: bun run 2:webhook");
  process.exit(1);
}

const fullUrl = `${ngrokBase.replace(/\/$/, "")}${WEBHOOK_PATH}`;
const webhookId = randomUUID();

console.log(`Registering webhook:`);
console.log(`  webhookId : ${webhookId}`);
console.log(`  eventType : ${EVENT_TYPE}`);
console.log(`  url       : ${fullUrl}`);
console.log();

try {
  const response = await etherfuse.post<CreateWebhookResponse>("/ramp/webhook", {
    id: webhookId,
    eventType: EVENT_TYPE,
    url: fullUrl,
  });

  if (!response.secret) {
    console.error("✗ Response had no `secret` field — webhook will fail signature verification.");
    console.error("  Raw response:", JSON.stringify(response, null, 2));
    process.exit(1);
  }

  await mkdir(".data", { recursive: true });
  await writeFile(
    WEBHOOK_SECRET_PATH,
    JSON.stringify(
      {
        webhookId: response.id,
        url: response.url,
        secret: response.secret,
        eventType: response.eventType,
        createdAt: response.createdAt,
      },
      null,
      2,
    ),
  );

  console.log(`✓ Registered, secret stored in ${WEBHOOK_SECRET_PATH}`);
  console.log("  (Etherfuse only returns the secret once — do not delete this file.)");
  console.log();
  console.log("Start the server: bun run 2:webhook");
} catch (err: unknown) {
  printEtherfuseError(err);
  process.exit(1);
}
