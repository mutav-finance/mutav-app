"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { formatBRLCents } from "@mutav/i18n/brazil";
import {
  activationStepPosition,
  activationSteps,
  outcomeForRetry,
  outcomeForThrownRetry,
  type ActivationOutcome,
} from "@/components/guarantees/view-model";

type UseActivationDetailArgs = {
  preloaded: Preloaded<typeof api.guarantees.activationQueries.getActivationDetail>;
};

/**
 * View model for one guarantee's activation page. Nobody clicks Activate: a
 * guarantee goes active when compliance approves its signed contract and the
 * reserve capacity check passes (issue #427). While it waits for reserve
 * capacity compliance may retry; whether the retry is on offer follows the
 * blockers the server reports — never local state. Owns the in-flight flag
 * and the toasts.
 */
export function useActivationDetail({ preloaded }: UseActivationDetailArgs) {
  const t = useTranslations("staffGuarantees");
  const detail = usePreloadedQuery(preloaded);
  const retryActivation = useMutation(api.guarantees.activation.retryActivation);

  const [busy, setBusy] = useState(false);

  const blockers = detail?.blockers ?? [];
  const isDraft = detail !== null && detail.status === "drafted";
  const canRetry = isDraft && blockers.length === 0;
  const isWaitingForCapacity = isDraft && detail.review.status === "awaiting_capacity";
  const stepInput = detail ? { status: detail.status, review: detail.review.status } : null;

  function report(outcome: ActivationOutcome) {
    if (outcome.kind === "activated") toast.success(t(outcome.messageKey));
    else if (outcome.kind === "waiting") {
      toast.warning(
        t(outcome.messageKey, { shortfall: formatBRLCents(outcome.shortfallCents ?? 0) }),
      );
    } else toast.error(t(outcome.messageKey));
  }

  async function retry() {
    if (!detail || !canRetry) return;
    const publicId = detail.publicId;
    setBusy(true);
    try {
      report(outcomeForRetry(await retryActivation({ publicId })));
    } catch (error) {
      report(outcomeForThrownRetry(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    detail,
    busy,
    blockers,
    canRetry,
    isWaitingForCapacity,
    isActive: detail !== null && detail.status !== "drafted" && detail.activatedAt !== null,
    steps: stepInput ? activationSteps(stepInput) : [],
    stepPosition: stepInput ? activationStepPosition(stepInput) : 1,
    retry,
  };
}

export type ActivationDetailViewModel = ReturnType<typeof useActivationDetail>;
