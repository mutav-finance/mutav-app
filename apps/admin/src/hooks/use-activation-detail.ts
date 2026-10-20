"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import {
  activationStepPosition,
  outcomeForActivation,
  outcomeForThrownActivation,
  type ActivationOutcome,
} from "@/components/guarantees/view-model";

type UseActivationDetailArgs = {
  preloaded: Preloaded<typeof api.guarantees.activationQueries.getActivationDetail>;
};

/**
 * View model for one guarantee's activation page. Whether Activate is on
 * offer follows the blockers the server reports — the same list
 * `staffActivate` checks — never local state. Owns the confirm dialog, the
 * in-flight flag and the toasts.
 */
export function useActivationDetail({ preloaded }: UseActivationDetailArgs) {
  const t = useTranslations("staffGuarantees");
  const detail = usePreloadedQuery(preloaded);
  const staffActivate = useMutation(api.guarantees.mutations.staffActivate);

  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const blockers = detail?.blockers ?? [];
  const canActivate = detail !== null && blockers.length === 0;
  const stepPosition = detail
    ? activationStepPosition({ status: detail.status, review: detail.review.status })
    : 1;

  function report(outcome: ActivationOutcome) {
    if (outcome.kind === "success") toast.success(t(outcome.messageKey));
    else toast.error(t(outcome.messageKey));
  }

  async function confirmActivate() {
    if (!detail || !canActivate) return;
    const publicId = detail.publicId;
    setBusy(true);
    try {
      const outcome = outcomeForActivation(await staffActivate({ publicId }));
      report(outcome);
      if (outcome.kind === "success") setConfirmOpen(false);
    } catch (error) {
      report(outcomeForThrownActivation(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    detail,
    busy,
    blockers,
    canActivate,
    isActive: detail !== null && detail.status !== "drafted" && detail.activatedAt !== null,
    stepPosition,
    confirm: {
      isOpen: confirmOpen,
      open: () => setConfirmOpen(true),
      close: () => setConfirmOpen(false),
      submit: confirmActivate,
    },
  };
}

export type ActivationDetailViewModel = ReturnType<typeof useActivationDetail>;
