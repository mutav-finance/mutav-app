"use client";

import { useState } from "react";
import { useAction, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import {
  activationStepPosition,
  isTxSignatureInput,
  outcomeForRegistration,
  outcomeForThrownRegistration,
  type RegistrationOutcome,
} from "@/components/guarantees/view-model";

type UseActivationDetailArgs = {
  preloaded: Preloaded<typeof api.guarantees.activationQueries.getActivationDetail>;
};

/**
 * View model for one guarantee's activation page. Nobody clicks Activate
 * (ADR 0010): staff paste the operator's `register_guarantee` transaction
 * signature and Convex verifies it on chain. Whether the form is on offer
 * follows the blockers the server reports — the same list
 * `confirmRegistration` checks — never local state. Owns the signature
 * input, the in-flight flag and the toasts.
 */
export function useActivationDetail({ preloaded }: UseActivationDetailArgs) {
  const t = useTranslations("staffGuarantees");
  const detail = usePreloadedQuery(preloaded);
  const confirmRegistration = useAction(api.guarantees.registration.confirmRegistration);

  const [busy, setBusy] = useState(false);
  const [txSignature, setTxSignature] = useState("");

  const blockers = detail?.blockers ?? [];
  const canRegister = detail !== null && blockers.length === 0;
  const signatureIsValid = isTxSignatureInput(txSignature);
  const stepPosition = detail
    ? activationStepPosition({ status: detail.status, review: detail.review.status })
    : 1;

  function report(outcome: RegistrationOutcome) {
    if (outcome.kind === "success") toast.success(t(outcome.messageKey));
    else if (outcome.kind === "refused") {
      toast.error(t(outcome.messageKey, { error: outcome.programErrorName }));
    } else toast.error(t(outcome.messageKey));
  }

  async function submit() {
    if (!detail || !canRegister || !signatureIsValid) return;
    const publicId = detail.publicId;
    setBusy(true);
    try {
      const result = await confirmRegistration({ publicId, txSignature: txSignature.trim() });
      const outcome = outcomeForRegistration(result);
      report(outcome);
      if (outcome.kind !== "error") setTxSignature("");
    } catch (error) {
      report(outcomeForThrownRegistration(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    detail,
    busy,
    blockers,
    canRegister,
    isActive: detail !== null && detail.status !== "drafted" && detail.activatedAt !== null,
    stepPosition,
    registration: {
      txSignature,
      setTxSignature,
      signatureIsValid,
      submit,
    },
  };
}

export type ActivationDetailViewModel = ReturnType<typeof useActivationDetail>;
