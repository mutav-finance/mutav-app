"use client";

import { useState } from "react";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";

type UseUnderwritingQueueArgs = {
  queue: Preloaded<typeof api.guarantees.reviewQueries.listAnalysisQueue>;
  awaitingDispatch: Preloaded<typeof api.guarantees.reviewQueries.listAwaitingDispatch>;
};

/**
 * View model for the underwriting queue. Read-only: every decision is taken
 * on the case-file page, where the reviewer sees the whole file first.
 */
export function useUnderwritingQueue({ queue, awaitingDispatch }: UseUnderwritingQueueArgs) {
  const queueResult = usePreloadedQuery(queue);
  const dispatchRows = usePreloadedQuery(awaitingDispatch);
  // Stamped once per mount so "waiting N days" does not re-derive every render.
  const [now] = useState(() => Date.now());

  return {
    rows: queueResult.page,
    isDone: queueResult.isDone,
    dispatchRows,
    now,
  };
}
