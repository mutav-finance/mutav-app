import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHmac, timingSafeEqual } from "node:crypto";
import canonicalize from "canonicalize";

const WEBHOOK_SECRET_PATH = ".data/etherfuse-webhook.json";
const EVENT_LOG_PATH = ".data/etherfuse-webhook-events.jsonl";
const SEEN_IDS_PATH = ".data/etherfuse-webhook-seen.json";
const PORT = 3000;

type WebhookRecord = {
  webhookId: string;
  url: string;
  secret: string;
  eventType: string;
  createdAt: string;
};

type ParsedEvent = {
  id?: string;
  eventId?: string;
  type?: string;
  eventType?: string;
} & Record<string, unknown>;

const readWebhookRecord = async (): Promise<WebhookRecord> => {
  try {
    const raw = await readFile(WEBHOOK_SECRET_PATH, "utf-8");
    // Disk boundary: trust what we wrote.
    return JSON.parse(raw) as WebhookRecord;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      throw new Error(
        "No webhook on file. Run `bun run 2:webhook:register https://your-ngrok-url` first.",
      );
    }
    throw err;
  }
};

const readSeenIds = async (): Promise<Set<string>> => {
  try {
    const raw = await readFile(SEEN_IDS_PATH, "utf-8");
    const arr: unknown = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []);
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return new Set();
    }
    throw err;
  }
};

const persistSeenIds = async (ids: Set<string>): Promise<void> => {
  await writeFile(SEEN_IDS_PATH, JSON.stringify([...ids], null, 2));
};

const verifySignature = (
  parsedBody: unknown,
  signatureHeader: string,
  secretBase64: string,
): boolean => {
  // Etherfuse signs the canonicalized JSON (RFC 8785 JCS), not the raw bytes.
  // Comparing raw HTTP body would always fail because key ordering varies.
  const canonical = canonicalize(parsedBody);
  if (canonical === undefined) return false;
  const key = Buffer.from(secretBase64, "base64");
  const hmac = createHmac("sha256", key).update(canonical).digest("hex");
  const expected = `sha256=${hmac}`;
  if (expected.length !== signatureHeader.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
};

const extractEventId = (event: ParsedEvent): string | null => event.id ?? event.eventId ?? null;

const handleWebhook = async (request: Request, webhook: WebhookRecord): Promise<Response> => {
  const rawBody = await request.text();

  let parsed: ParsedEvent;
  try {
    // Disk boundary: validating below.
    parsed = JSON.parse(rawBody) as ParsedEvent;
  } catch {
    console.error("✗ Body is not valid JSON");
    return new Response("invalid json", { status: 400 });
  }

  const signatureHeader = request.headers.get("x-signature");
  if (!signatureHeader) {
    console.error("✗ Missing X-Signature header");
    return new Response("missing signature", { status: 401 });
  }
  if (!verifySignature(parsed, signatureHeader, webhook.secret)) {
    console.error("✗ Signature verification FAILED");
    console.error("  Either the secret is wrong or the body was tampered with.");
    return new Response("bad signature", { status: 401 });
  }

  const eventId = extractEventId(parsed);
  const seen = await readSeenIds();
  if (eventId && seen.has(eventId)) {
    console.log(`↺ Duplicate event ${eventId} — ignored (idempotency)`);
    return new Response("duplicate, ignored", { status: 200 });
  }

  const eventType = parsed.type ?? parsed.eventType ?? "unknown";
  console.log(`✓ ${new Date().toISOString()}  ${eventType}  id=${eventId ?? "(no id)"}`);

  await mkdir(".data", { recursive: true });
  await appendFile(
    EVENT_LOG_PATH,
    JSON.stringify({ receivedAt: new Date().toISOString(), ...parsed }) + "\n",
  );

  if (eventId) {
    seen.add(eventId);
    await persistSeenIds(seen);
  }

  return new Response("ok", { status: 200 });
};

const webhook = await readWebhookRecord();

console.log("=== Etherfuse webhook server ===");
console.log(`  registered URL : ${webhook.url}`);
console.log(`  eventType      : ${webhook.eventType}`);
console.log(`  listening      : http://localhost:${PORT}/webhooks/etherfuse`);
console.log();
console.log("Make sure ngrok is forwarding the public URL above to this port.");
console.log("Events land in .data/etherfuse-webhook-events.jsonl");
console.log();

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/webhooks/etherfuse") {
      return handleWebhook(request, webhook);
    }
    return new Response("not found", { status: 404 });
  },
});
