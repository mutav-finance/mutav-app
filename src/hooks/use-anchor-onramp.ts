"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";

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

export type AnchorOnrampPhase =
  | "idle"
  | "starting"
  | "awaiting_payment"
  | "processing"
  | "completed"
  | "failed";

export interface AnchorStartErrorPayload {
  code: string;
  detail?: string;
}

type StartActionResult =
  | { success: true; data: { orderId: Id<"anchorOrders">; anchorTxId: string; hostedUrl?: string } }
  | { success: false; error: AnchorStartErrorPayload };

type StartActionRef = FunctionReference<
  "action",
  "public",
  { paymentId: Id<"payments">; lang?: string },
  StartActionResult
>;

type PollActionRef = FunctionReference<
  "action",
  "public",
  { orderId: Id<"anchorOrders"> },
  { orderId: Id<"anchorOrders">; status: AnchorOrderStatus; terminal: boolean }
>;

interface UseAnchorOnrampArgs {
  paymentId: Id<"payments">;
  startAction: StartActionRef;
  pollAction: PollActionRef;
  /** Forwarded as the SEP-24/SEP-6 `lang` field so the anchor renders its hosted UI in this locale. */
  lang?: string;
}

interface UseAnchorOnrampResult {
  phase: AnchorOnrampPhase;
  order: AnchorOrder | null;
  /** Structured error from the start action (code is stable, suitable for i18n lookup). */
  error: AnchorStartErrorPayload | null;
  start: () => Promise<void>;
  cancel: () => void;
  /** Resets local state so the user can retry from `idle`. Does not refund or void anything anchor-side. */
  reset: () => void;
}

/**
 * View-model hook for any anchor on-ramp flow (SEP-6 inline Pix, SEP-24
 * hosted UI, future Etherfuse, …). Parameterized by which start/poll action
 * pair to call — the lifecycle, polling cadence, and `anchorOrders`
 * subscription are identical across providers.
 */
export function useAnchorOnramp({
  paymentId,
  startAction: startActionRef,
  pollAction: pollActionRef,
  lang,
}: UseAnchorOnrampArgs): UseAnchorOnrampResult {
  const [orderId, setOrderId] = useState<Id<"anchorOrders"> | null>(null);
  const [startError, setStartError] = useState<AnchorStartErrorPayload | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const startAction = useAction(startActionRef);
  const pollAction = useAction(pollActionRef);

  const order =
    useQuery(api.anchors.orderUseCases.getOrderById, orderId ? { orderId } : "skip") ?? null;

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!orderId) return;
    if (order && TERMINAL_STATUSES.has(order.status)) {
      clearPolling();
      return;
    }

    const tick = () => {
      pollAction({ orderId }).catch((err: unknown) => {
        console.warn("[anchor-onramp] poll failed", err);
      });
    };
    tick();
    pollIntervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return clearPolling;
  }, [orderId, order, pollAction, clearPolling]);

  useEffect(() => clearPolling, [clearPolling]);

  const start = useCallback(async () => {
    setStartError(null);
    setIsStarting(true);
    try {
      const result = await startAction({ paymentId, lang });
      if (result.success) {
        setOrderId(result.data.orderId);
      } else {
        setStartError(result.error);
      }
    } catch (err) {
      setStartError({
        code: "INTERNAL",
        detail: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsStarting(false);
    }
  }, [paymentId, startAction, lang]);

  const cancel = useCallback(() => {
    clearPolling();
  }, [clearPolling]);

  const reset = useCallback(() => {
    clearPolling();
    setOrderId(null);
    setStartError(null);
  }, [clearPolling]);

  const phase: AnchorOnrampPhase = derivePhase({
    isStarting,
    startError,
    order,
  });

  return {
    phase,
    order,
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
  startError: AnchorStartErrorPayload | null;
  order: AnchorOrder | null;
}): AnchorOnrampPhase {
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
