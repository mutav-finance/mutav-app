/**
 * Register the Convex anchor webhook URL with the Etherfuse sandbox.
 *
 * Etherfuse appears to require one webhook subscription per event type
 * (CreateWebhookRequest in the OpenAPI takes a single `eventType`), so this
 * script POSTs twice — once for `order_updated` and once for `kyc_updated`.
 * The response body for each registration includes a `secret` field. Paste
 * it into the operator-managed `ETHERFUSE_WEBHOOK_SECRET` env var so the
 * real handler (workstream WC) can verify signatures.
 *
 * Required env:
 *
 *   ETHERFUSE_API_KEY     api_sand:... key from devnet.etherfuse.com
 *   CONVEX_HTTP_URL       Convex deployment's HTTP origin, e.g.
 *                         https://<name>.convex.site (run `bunx convex env
 *                         get CONVEX_SITE_URL` or grab from the Convex
 *                         dashboard → Settings → URL & Deploy Key).
 *
 * Optional env:
 *
 *   ETHERFUSE_BASE_URL    Defaults to https://api.sand.etherfuse.com
 *
 * Authorization header is the raw key — no `Bearer` prefix (matches the
 * convention used by scripts/etherfuse-smoke.ts).
 *
 * Usage:
 *
 *   export ETHERFUSE_API_KEY=api_sand:...
 *   export CONVEX_HTTP_URL=https://<deployment>.convex.site
 *   bun scripts/register-etherfuse-webhook.ts
 *
 * Or print this help:
 *
 *   bun scripts/register-etherfuse-webhook.ts --help
 */

const HELP_FLAGS = new Set(["--help", "-h", "help"]);
const EVENT_TYPES = ["order_updated", "kyc_updated"] as const;

type EtherfuseEventType = (typeof EVENT_TYPES)[number];

function printHelp(): void {
  // Read the script's own top docblock for the help text — single source.
  console.log(
    [
      "register-etherfuse-webhook.ts",
      "",
      "Registers the Convex /anchors/webhook URL with the Etherfuse sandbox,",
      "once per event type (order_updated, kyc_updated), and prints the",
      "per-webhook signing secret returned by Etherfuse.",
      "",
      "Required env: ETHERFUSE_API_KEY, CONVEX_HTTP_URL",
      "Optional env: ETHERFUSE_BASE_URL (default https://api.sand.etherfuse.com)",
      "",
      "See the file header for full setup instructions.",
    ].join("\n"),
  );
}

if (process.argv.slice(2).some((arg) => HELP_FLAGS.has(arg))) {
  printHelp();
  process.exit(0);
}

const API_KEY = process.env.ETHERFUSE_API_KEY;
const BASE_URL = process.env.ETHERFUSE_BASE_URL ?? "https://api.sand.etherfuse.com";
const CONVEX_HTTP_URL = process.env.CONVEX_HTTP_URL;

if (!API_KEY) {
  console.error("ETHERFUSE_API_KEY is required. See script header for setup.");
  process.exit(1);
}

if (!CONVEX_HTTP_URL) {
  console.error("CONVEX_HTTP_URL is required. See script header for setup.");
  process.exit(1);
}

const webhookUrl = `${CONVEX_HTTP_URL.replace(/\/$/, "")}/anchors/webhook`;

async function registerWebhook(eventType: EtherfuseEventType): Promise<void> {
  const id = crypto.randomUUID();
  const url = `${BASE_URL}/ramp/webhook`;

  console.log(`\n→ POST ${url}`);
  console.log(`  eventType: ${eventType}`);
  console.log(`  url:       ${webhookUrl}`);
  console.log(`  id:        ${id}`);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Etherfuse expects the raw key — no Bearer prefix.
      authorization: API_KEY!,
    },
    body: JSON.stringify({ id, eventType, url: webhookUrl }),
  });

  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Leave parsed as the raw text body.
  }

  console.log(`  status:    ${response.status}`);
  console.log(`  body:      ${JSON.stringify(parsed, null, 2)}`);

  if (!response.ok) {
    console.error(`✖ Failed to register webhook for ${eventType}`);
    return;
  }

  if (typeof parsed === "object" && parsed !== null && "secret" in parsed) {
    const secret = (parsed as { secret: unknown }).secret;
    if (typeof secret === "string") {
      console.log(`\n  ⚑ secret for ${eventType}: ${secret}`);
      console.log("    Paste this into ETHERFUSE_WEBHOOK_SECRET on the");
      console.log("    Convex deployment (bunx convex env set).");
    }
  }
}

async function main(): Promise<void> {
  console.log(`Registering webhooks against ${BASE_URL}`);
  console.log(`Convex URL: ${webhookUrl}`);

  for (const eventType of EVENT_TYPES) {
    await registerWebhook(eventType);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("✖ unexpected error", err);
  process.exit(1);
});
