"use client";

import { useState } from "react";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import {
  ACTIVATION_TAB,
  isActivationTab,
  type ActivationTab,
} from "@/components/guarantees/view-model";

type ActivationQueuePreload = Preloaded<
  typeof api.guarantees.activationQueries.listActivationQueue
>;

type UseActivationQueueArgs = {
  awaitingCapacity: ActivationQueuePreload;
  awaitingSignature: ActivationQueuePreload;
};

/**
 * View model for the staff guarantees list. Read-only: a retry runs from the
 * detail page, where compliance sees the capacity check first. Both tabs are
 * preloaded so switching never flashes an empty table.
 */
export function useActivationQueue({
  awaitingCapacity,
  awaitingSignature,
}: UseActivationQueueArgs) {
  const capacityQueue = usePreloadedQuery(awaitingCapacity);
  const signatureQueue = usePreloadedQuery(awaitingSignature);
  const [tab, setTab] = useState<ActivationTab>(ACTIVATION_TAB.AWAITING_CAPACITY);

  const queues = {
    [ACTIVATION_TAB.AWAITING_CAPACITY]: capacityQueue,
    [ACTIVATION_TAB.AWAITING_SIGNATURE]: signatureQueue,
  } as const;

  return {
    tab,
    selectTab: (value: string) => {
      if (isActivationTab(value)) setTab(value);
    },
    counts: {
      [ACTIVATION_TAB.AWAITING_CAPACITY]: capacityQueue.rows.length,
      [ACTIVATION_TAB.AWAITING_SIGNATURE]: signatureQueue.rows.length,
    },
    rows: queues[tab].rows,
    hasMore: queues[tab].hasMore,
  };
}
