"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CoverPayoutRow } from "@convex/coverOperations/useCases";
import {
  DEFAULT_ACTION,
  outcomeForResult,
  outcomeForThrown,
} from "@/components/defaults/view-model";
import { useOutcomeReporter } from "@/hooks/use-defaults-queue";

type UseCoverPayoutsArgs = {
  preloaded: Preloaded<typeof api.coverOperations.useCases.listAwaitingPayout>;
};

/**
 * View-model hook for the payouts-awaiting-execution panel: recorded covers
 * whose off-chain payment has not been confirmed. Owns the execute dialog
 * and its in-flight flag; outcome mapping lives in the shared pure module.
 */
export function useCoverPayouts({ preloaded }: UseCoverPayoutsArgs) {
  const result = usePreloadedQuery(preloaded);
  const report = useOutcomeReporter();
  const markExecuted = useMutation(api.coverOperations.mutations.staffMarkCoverExecuted);

  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<CoverPayoutRow | null>(null);
  const [paymentReference, setPaymentReference] = useState("");
  const [note, setNote] = useState("");

  function open(row: CoverPayoutRow) {
    setTarget(row);
    setPaymentReference("");
    setNote("");
  }

  async function confirm() {
    const row = target;
    const reference = paymentReference.trim();
    if (!row || !reference) return;

    setBusy(true);
    try {
      const outcome = outcomeForResult({
        action: DEFAULT_ACTION.EXECUTE,
        result: await markExecuted({
          operationPublicId: row.publicId,
          paymentReference: reference,
          note: note.trim() || undefined,
        }),
      });
      report(outcome);
      if (outcome.kind === "success") setTarget(null);
    } catch (error) {
      report(outcomeForThrown(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    rows: result.page,
    isDone: result.isDone,
    busy,
    execute: {
      target,
      open,
      close: () => setTarget(null),
      paymentReference,
      setPaymentReference,
      note,
      setNote,
      canConfirm: paymentReference.trim().length > 0 && !busy,
      confirm,
    },
  };
}

export type CoverPayoutsViewModel = ReturnType<typeof useCoverPayouts>;
