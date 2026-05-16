"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";

import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";

type AnchorOrder = Doc<"anchorOrders">;
type AnchorOrderStatus = AnchorOrder["status"];

const POLL_INTERVAL_MS = 5_000;
const TERMINAL_STATUSES: ReadonlySet<AnchorOrderStatus> = new Set([
  "completed",
  "refunded",
  "expired",
  "error",
]);

export type PixOnrampPhase =
  | "idle"
  | "starting"
  | "awaiting_payment"
  | "processing"
  | "completed"
  | "failed";

interface UsePixOnrampResult {
  phase: PixOnrampPhase;
  order: AnchorOrder | null;
  hostedUrl: string | null;
  error: string | null;
  start: () => Promise<void>;
  cancel: () => void;
  /** Resets local state so the user can retry from `idle`. Does not refund or void anything anchor-side. */
  reset: () => void;
}

/**
 * View-model hook for the Pix on-ramp flow.
 *
 * Orchestrates the action calls (start + poll), subscribes reactively to
 * the underlying `anchorOrders` row so status transitions surface to the
 * UI without re-fetching, and manages the polling lifecycle (clears on
 * terminal status, cancel, or unmount).
 *
 * The hosted URL hand-off (popup vs new tab) is the consumer component's
 * call — this hook just exposes `hostedUrl`. Once a popup closes, polling
 * still runs and resolves to the final status the anchor reports.
 */
export function usePixOnramp({ paymentId }: { paymentId: Id<"payments"> }): UsePixOnrampResult {
  const [orderId, setOrderId] = useState<Id<"anchorOrders"> | null>(null);
  const [hostedUrl, setHostedUrl] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const startAction = useAction(api.anchors.actions.startPixOnramp);
  const pollAction = useAction(api.anchors.actions.pollPixOnramp);

  const order =
    useQuery(api.anchors.orderUseCases.getOrderById, orderId ? { orderId } : "skip") ?? null;

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Drive the poll loop while an order exists and is not yet terminal.
  useEffect(() => {
    if (!orderId) return;
    if (order && TERMINAL_STATUSES.has(order.status)) {
      clearPolling();
      return;
    }

    // Fire once immediately, then on interval — gives the UI a first update
    // without a 5s wait after the popup opens.
    const tick = () => {
      pollAction({ orderId }).catch((err: unknown) => {
        // Transient poll failures don't tear down the loop; the next tick retries.
        // Surfacing per-tick errors as the global error would flicker on minor
        // network blips, so we just log.
        console.warn("[pix-onramp] poll failed", err);
      });
    };
    tick();
    pollIntervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return clearPolling;
  }, [orderId, order, pollAction, clearPolling]);

  // Cleanup on unmount.
  useEffect(() => clearPolling, [clearPolling]);

  const start = useCallback(async () => {
    setStartError(null);
    setIsStarting(true);
    try {
      const result = await startAction({ paymentId });
      setOrderId(result.orderId);
      setHostedUrl(result.hostedUrl);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsStarting(false);
    }
  }, [paymentId, startAction]);

  const cancel = useCallback(() => {
    clearPolling();
  }, [clearPolling]);

  const reset = useCallback(() => {
    clearPolling();
    setOrderId(null);
    setHostedUrl(null);
    setStartError(null);
  }, [clearPolling]);

  const phase: PixOnrampPhase = derivePhase({
    isStarting,
    startError,
    order,
  });

  return {
    phase,
    order,
    hostedUrl,
    error: startError,
    start,
    cancel,
    reset,
  };
}

function derivePhase({
  isStarting,
  startError,
  order,
}: {
  isStarting: boolean;
  startError: string | null;
  order: AnchorOrder | null;
}): PixOnrampPhase {
  if (startError) return "failed";
  if (isStarting) return "starting";
  if (!order) return "idle";

  switch (order.status) {
    case "incomplete":
    case "pending_user_transfer_start":
      return "awaiting_payment";
    case "pending_user_transfer_complete":
    case "pending_anchor":
    case "pending_stellar":
      return "processing";
    case "completed":
      return "completed";
    case "refunded":
    case "expired":
    case "error":
      return "failed";
  }
}
