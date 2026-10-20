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
  signed: ActivationQueuePreload;
  awaitingSignature: ActivationQueuePreload;
};

/**
 * View model for the staff guarantees list. Read-only: activation happens on
 * the detail page, where compliance sees every precondition first. Both tabs
 * are preloaded so switching never flashes an empty table.
 */
export function useActivationQueue({ signed, awaitingSignature }: UseActivationQueueArgs) {
  const signedQueue = usePreloadedQuery(signed);
  const awaitingQueue = usePreloadedQuery(awaitingSignature);
  const [tab, setTab] = useState<ActivationTab>(ACTIVATION_TAB.SIGNED);

  const queues = {
    [ACTIVATION_TAB.SIGNED]: signedQueue,
    [ACTIVATION_TAB.AWAITING_SIGNATURE]: awaitingQueue,
  } as const;

  return {
    tab,
    selectTab: (value: string) => {
      if (isActivationTab(value)) setTab(value);
    },
    counts: {
      [ACTIVATION_TAB.SIGNED]: signedQueue.rows.length,
      [ACTIVATION_TAB.AWAITING_SIGNATURE]: awaitingQueue.rows.length,
    },
    rows: queues[tab].rows,
    hasMore: queues[tab].hasMore,
  };
}
