import { etherfuse, printEtherfuseError } from "../lib/etherfuse.ts";

type OrderStatus =
  | "created"
  | "funded"
  | "completed"
  | "finalized"
  | "failed"
  | "refunded"
  | "canceled";

type OrderDetails = {
  orderId: string;
  status: OrderStatus;
  orderType: "onramp" | "offramp";
  amountInFiat?: number;
  amountInTokens?: number;
  confirmedTxSignature?: string | null;
  statusPage?: string | null;
  completedAt?: string | null;
} & Record<string, unknown>;

const POLL_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES = new Set<OrderStatus>([
  "completed",
  "finalized",
  "failed",
  "refunded",
  "canceled",
]);

const orderId = Bun.argv[2];
if (!orderId) {
  console.error("Usage: bun run 2:poll <orderId>");
  console.error("  (the orderId comes from `bun run 2:onramp` or `bun run 2:offramp`)");
  process.exit(1);
}

console.log(`Polling order ${orderId} every ${POLL_INTERVAL_MS / 1000}s — Ctrl-C to stop.`);
console.log();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let lastStatus: OrderStatus | null = null;
let iteration = 0;

while (true) {
  iteration++;
  try {
    const order = await etherfuse.get<OrderDetails>(`/ramp/order/${orderId}`);

    if (order.status !== lastStatus) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] status: ${lastStatus ?? "(initial)"} → ${order.status}`);
      if (order.confirmedTxSignature) {
        console.log(`             txSig : ${order.confirmedTxSignature}`);
      }
      if (order.statusPage) {
        console.log(`             page  : ${order.statusPage}`);
      }
      lastStatus = order.status;
    } else if (iteration % 6 === 0) {
      // Every 30s, print a heartbeat so the user knows we're still alive.
      process.stdout.write(".");
    }

    if (TERMINAL_STATUSES.has(order.status)) {
      console.log();
      console.log(`✓ Reached terminal state: ${order.status}`);
      console.log();
      console.log("Full final order:");
      console.log(JSON.stringify(order, null, 2));
      break;
    }
  } catch (err: unknown) {
    printEtherfuseError(err);
    break;
  }

  await sleep(POLL_INTERVAL_MS);
}
