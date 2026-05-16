/**
 * Generic transaction-status poller shared by SEP-24 and SEP-31.
 *
 * - Sleeps wake early on AbortSignal.
 * - Retries up to N consecutive transient (5xx) errors before giving up.
 * - Notifies on status transitions, not on every tick.
 * - Throws `SepApiError` on timeout; `DOMException("AbortError")` on abort.
 */

import type { TransactionStatus } from "./types";
import { SepApiError } from "./types";

export interface PollOptions<T> {
  interval?: number;
  timeout?: number;
  signal?: AbortSignal;
  onStatusChange?: (transaction: T) => void;
  shouldStop?: (status: TransactionStatus) => boolean;
  maxTransientRetries?: number;
}

export async function pollUntilTerminal<T extends { status: TransactionStatus }>(
  fetchOnce: () => Promise<T>,
  options: PollOptions<T> = {},
): Promise<T> {
  const {
    interval = 5000,
    timeout = 600000,
    signal,
    onStatusChange,
    shouldStop = defaultShouldStop,
    maxTransientRetries = 3,
  } = options;

  const startTime = Date.now();
  let lastStatus: TransactionStatus | null = null;
  let consecutiveTransient = 0;

  while (Date.now() - startTime < timeout) {
    throwIfAborted(signal);

    try {
      const transaction = await fetchOnce();
      consecutiveTransient = 0;

      if (transaction.status !== lastStatus) {
        lastStatus = transaction.status;
        onStatusChange?.(transaction);
      }

      if (shouldStop(transaction.status)) return transaction;
    } catch (error) {
      const isTransient = error instanceof SepApiError && error.status >= 500;
      if (!isTransient || ++consecutiveTransient > maxTransientRetries) throw error;
    }

    await sleep(interval, signal);
  }

  throw new SepApiError(`Transaction polling timed out after ${timeout}ms`, 0);
}

function defaultShouldStop(status: TransactionStatus): boolean {
  return (
    status === "completed" || status === "error" || status === "expired" || status === "refunded"
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Polling aborted", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Polling aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Polling aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
