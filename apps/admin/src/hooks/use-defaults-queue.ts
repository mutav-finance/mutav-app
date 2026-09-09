"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { DelinquencyAdminQueueRow } from "@convex/delinquencies/useCases";
import {
  DEFAULT_ACTION,
  coverPreview,
  outcomeForResult,
  outcomeForThrown,
  type CoverPreview,
} from "@/components/defaults/view-model";

/**
 * `staff_dismissed` says the arrears was never real and hands the guarantee
 * back its performing state; `staff_dispute` rules the claim invalid but
 * leaves the guarantee in default for a reversal to close. Both travel to the
 * same mutation as `disposition.kind`, so the operator picks between them.
 */
export const DISMISSAL_KINDS = ["staff_dismissed", "staff_dispute"] as const;
export type DismissalKind = (typeof DISMISSAL_KINDS)[number];

type UseDefaultsQueueArgs = {
  preloaded: Preloaded<typeof api.delinquencies.useCases.listOpenAdminQueue>;
};

/**
 * View-model hook for the defaults queue. Owns dialog state, the in-flight
 * flag and the toast/translation wiring; every decision it makes (which
 * message key an outcome earns, what the cover clamp will do) is delegated to
 * the pure module beside it, which is where the tests live.
 */
export function useDefaultsQueue({ preloaded }: UseDefaultsQueueArgs) {
  const result = usePreloadedQuery(preloaded);
  const t = useTranslations("defaults");

  const verifyDefault = useMutation(api.delinquencies.mutations.staffVerifyDefault);
  const markResolvedByCover = useMutation(api.delinquencies.mutations.staffMarkResolvedByCover);
  const markCanceledByDismissal = useMutation(
    api.delinquencies.mutations.staffMarkCanceledByDismissal,
  );

  const [busyNoticeId, setBusyNoticeId] = useState<string | null>(null);

  // Stamped once per mount, in a lazy initializer rather than in render: the
  // "open for N days" column must not re-derive from a moving clock on every
  // re-render, and reading the clock during render is impure.
  const [now] = useState(() => Date.now());

  const [coverTarget, setCoverTarget] = useState<DelinquencyAdminQueueRow | null>(null);
  const [coverOperationPublicId, setCoverOperationPublicId] = useState("");
  const [coverNote, setCoverNote] = useState("");

  const [dismissTarget, setDismissTarget] = useState<DelinquencyAdminQueueRow | null>(null);
  const [dismissKind, setDismissKind] = useState<DismissalKind>("staff_dismissed");
  const [dismissNote, setDismissNote] = useState("");

  function report(outcome: { kind: "success" | "error"; messageKey: string }) {
    if (outcome.kind === "success") {
      toast.success(t(outcome.messageKey));
      return;
    }
    toast.error(t(outcome.messageKey));
  }

  async function verify(row: DelinquencyAdminQueueRow) {
    setBusyNoticeId(row.publicId);
    try {
      const outcome = outcomeForResult({
        action: DEFAULT_ACTION.VERIFY,
        result: await verifyDefault({ noticePublicId: row.publicId }),
      });
      report(outcome);
    } catch (error) {
      report(outcomeForThrown(error));
    } finally {
      setBusyNoticeId(null);
    }
  }

  function openCover(row: DelinquencyAdminQueueRow) {
    setCoverTarget(row);
    setCoverOperationPublicId("");
    setCoverNote("");
  }

  async function confirmCover() {
    const row = coverTarget;
    if (!row) return;
    const reference = coverOperationPublicId.trim();
    if (!reference) return;

    setBusyNoticeId(row.publicId);
    try {
      const outcome = outcomeForResult({
        action: DEFAULT_ACTION.COVER,
        result: await markResolvedByCover({
          noticePublicId: row.publicId,
          coverOperationPublicId: reference,
          note: coverNote.trim() || undefined,
        }),
      });
      report(outcome);
      if (outcome.kind === "success") setCoverTarget(null);
    } catch (error) {
      report(outcomeForThrown(error));
    } finally {
      setBusyNoticeId(null);
    }
  }

  function openDismiss(row: DelinquencyAdminQueueRow) {
    setDismissTarget(row);
    setDismissKind("staff_dismissed");
    setDismissNote("");
  }

  async function confirmDismiss() {
    const row = dismissTarget;
    if (!row) return;

    setBusyNoticeId(row.publicId);
    try {
      const outcome = outcomeForResult({
        action: DEFAULT_ACTION.DISMISS,
        result: await markCanceledByDismissal({
          noticePublicId: row.publicId,
          disposition: { kind: dismissKind, note: dismissNote.trim() || undefined },
        }),
      });
      report(outcome);
      if (outcome.kind === "success") setDismissTarget(null);
    } catch (error) {
      report(outcomeForThrown(error));
    } finally {
      setBusyNoticeId(null);
    }
  }

  const preview: CoverPreview | null = coverTarget
    ? coverPreview({
        requestedCents: coverTarget.updatedAmountCents,
        capacity: coverTarget.guaranteeCapacity,
      })
    : null;

  return {
    rows: result.page,
    isDone: result.isDone,
    now,
    busyNoticeId,
    verify,
    cover: {
      target: coverTarget,
      close: () => setCoverTarget(null),
      open: openCover,
      operationPublicId: coverOperationPublicId,
      setOperationPublicId: setCoverOperationPublicId,
      note: coverNote,
      setNote: setCoverNote,
      preview,
      confirm: confirmCover,
    },
    dismiss: {
      target: dismissTarget,
      close: () => setDismissTarget(null),
      open: openDismiss,
      kind: dismissKind,
      setKind: setDismissKind,
      note: dismissNote,
      setNote: setDismissNote,
      confirm: confirmDismiss,
    },
  };
}

export type DefaultsQueueViewModel = ReturnType<typeof useDefaultsQueue>;
export type DefaultsQueueRow = DelinquencyAdminQueueRow;
