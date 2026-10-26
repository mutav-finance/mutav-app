"use client";

import { useState } from "react";
import { useAction, useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import {
  UNDERWRITING_ACTION,
  outcomeForResult,
  outcomeForThrown,
  parseHoldDaysInput,
  parseRatePercent,
  ratePercentInput,
  type ActionOutcome,
  type DecisionResult,
  type UnderwritingAction,
} from "@/components/underwriting/view-model";

type UseUnderwritingDetailArgs = {
  preloaded: Preloaded<typeof api.guarantees.reviewQueries.getAnalysisDetail>;
};

/**
 * View model for one case file. Owns the accept / refuse dialogs, their form
 * state, the optional hold-period override, the in-flight flag and the
 * toasts; which actions are on offer follows the review status the server
 * reports, never local state. Sending reads the reserve and holds capital for
 * the offer (ADR 0010), so it is an action; a re-send is on offer only once
 * the previous hold has lapsed.
 */
export function useUnderwritingDetail({ preloaded }: UseUnderwritingDetailArgs) {
  const t = useTranslations("underwriting");
  const detail = usePreloadedQuery(preloaded);

  const acceptAnalysis = useMutation(api.guarantees.reviewMutations.acceptAnalysis);
  const refuseAnalysis = useMutation(api.guarantees.reviewMutations.refuseAnalysis);
  const sendForSignature = useAction(api.guarantees.registration.sendForSignature);

  const [busy, setBusy] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [rateInput, setRateInput] = useState("");
  const [note, setNote] = useState("");
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [holdDaysInput, setHoldDaysInput] = useState("");

  const reviewStatus = detail?.review.status ?? null;
  const isDraft = detail?.status === "drafted";
  const canDecide = isDraft && reviewStatus === "analysis_requested";
  const canResend =
    isDraft && reviewStatus === "awaiting_signature" && detail?.review.offerHold !== "active";
  const canSend = (isDraft && reviewStatus === "accepted") || canResend;
  const parsedHoldDays = parseHoldDaysInput(holdDaysInput);
  const parsedRateBps = parseRatePercent(rateInput);

  function report(outcome: ActionOutcome) {
    if (outcome.kind === "success") toast.success(t(outcome.messageKey));
    else toast.error(t(outcome.messageKey));
  }

  async function run(
    action: UnderwritingAction,
    call: () => Promise<DecisionResult>,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const outcome = outcomeForResult({ action, result: await call() });
      report(outcome);
      return outcome.kind === "success";
    } catch (error) {
      report(outcomeForThrown(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openAccept() {
    if (!detail) return;
    setRateInput(ratePercentInput(detail.terms.feeRateBps));
    setNote("");
    setAcceptOpen(true);
  }

  async function confirmAccept() {
    if (!detail || parsedRateBps === null) return;
    const publicId = detail.publicId;
    const feeRateBps = parsedRateBps;
    const trimmedNote = note.trim();
    const ok = await run(UNDERWRITING_ACTION.ACCEPT, () =>
      acceptAnalysis({ publicId, feeRateBps, ...(trimmedNote ? { note: trimmedNote } : {}) }),
    );
    if (ok) setAcceptOpen(false);
  }

  function openRefuse() {
    setReason("");
    setRefuseOpen(true);
  }

  async function confirmRefuse() {
    if (!detail || reason.trim().length === 0) return;
    const publicId = detail.publicId;
    const ok = await run(UNDERWRITING_ACTION.REFUSE, () =>
      refuseAnalysis({ publicId, reason: reason.trim() }),
    );
    if (ok) setRefuseOpen(false);
  }

  async function send() {
    if (!detail || parsedHoldDays === null) return;
    const publicId = detail.publicId;
    const offerHoldDays = parsedHoldDays;
    const ok = await run(UNDERWRITING_ACTION.SEND, () =>
      sendForSignature({ publicId, ...(offerHoldDays === undefined ? {} : { offerHoldDays }) }),
    );
    if (ok) setHoldDaysInput("");
  }

  return {
    detail,
    busy,
    canDecide,
    canSend,
    canResend,
    holdDays: {
      input: holdDaysInput,
      setInput: setHoldDaysInput,
      isValid: parsedHoldDays !== null,
    },
    accept: {
      isOpen: acceptOpen,
      open: openAccept,
      close: () => setAcceptOpen(false),
      rateInput,
      setRateInput,
      rateIsValid: parsedRateBps !== null,
      note,
      setNote,
      confirm: confirmAccept,
    },
    refuse: {
      isOpen: refuseOpen,
      open: openRefuse,
      close: () => setRefuseOpen(false),
      reason,
      setReason,
      reasonIsValid: reason.trim().length > 0,
      confirm: confirmRefuse,
    },
    send,
  };
}

export type UnderwritingDetailViewModel = ReturnType<typeof useUnderwritingDetail>;
