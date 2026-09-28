"use client";

import { useState } from "react";
import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { DelinquencyAdminQueueRow } from "@convex/delinquencies/useCases";
import {
  DEFAULT_ACTION,
  REFUSING_NOTICE_MESSAGE_KEY,
  batchCoverPreview,
  coverPreview,
  outcomeForResult,
  outcomeForThrown,
  type ActionOutcome,
  type BatchCoverPreview,
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
 * Only a staff-verified notice may draw cover, so only those rows can join a
 * selection — offering the checkbox on an `open` row would build a batch the
 * server is certain to refuse whole.
 */
export function isCoverable(row: DelinquencyAdminQueueRow): boolean {
  return row.status === "verified";
}

/**
 * Toast wiring for an outcome. Shared by the queue and the payouts panel so a
 * batch refusal names its notice the same way everywhere.
 */
export function useOutcomeReporter() {
  const t = useTranslations("defaults");
  return (outcome: ActionOutcome) => {
    if (outcome.kind === "success") {
      toast.success(t(outcome.messageKey));
      return;
    }
    toast.error(t(outcome.messageKey), {
      description: outcome.noticePublicId
        ? t(REFUSING_NOTICE_MESSAGE_KEY, { notice: outcome.noticePublicId })
        : undefined,
    });
  };
}

/**
 * View-model hook for the defaults queue. Owns selection, dialog state, the
 * in-flight flag and the toast/translation wiring; every decision it makes
 * (which message key an outcome earns, what the cover clamp will do) is
 * delegated to the pure module beside it, which is where the tests live.
 */
export function useDefaultsQueue({ preloaded }: UseDefaultsQueueArgs) {
  const result = usePreloadedQuery(preloaded);
  const report = useOutcomeReporter();

  const verifyDefault = useMutation(api.delinquencies.mutations.staffVerifyDefault);
  const recordCover = useMutation(api.coverOperations.mutations.staffRecordCover);
  const recordCoverBatch = useMutation(api.coverOperations.mutations.staffRecordCoverBatch);
  const markCanceledByDismissal = useMutation(
    api.delinquencies.mutations.staffMarkCanceledByDismissal,
  );

  const [busy, setBusy] = useState(false);

  // Stamped once per mount, in a lazy initializer rather than in render: the
  // "open for N days" column must not re-derive from a moving clock on every
  // re-render, and reading the clock during render is impure.
  const [now] = useState(() => Date.now());

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());

  const [coverTargets, setCoverTargets] = useState<readonly DelinquencyAdminQueueRow[]>([]);
  const [coverNote, setCoverNote] = useState("");

  const [dismissTarget, setDismissTarget] = useState<DelinquencyAdminQueueRow | null>(null);
  const [dismissKind, setDismissKind] = useState<DismissalKind>("staff_dismissed");
  const [dismissNote, setDismissNote] = useState("");

  const rows = result.page;
  // A row that left the queue (covered, dismissed, or resolved elsewhere)
  // drops out of the selection on the next render rather than lingering in it.
  const selectedRows = rows.filter((row) => selectedIds.has(row.publicId) && isCoverable(row));
  const coverableRows = rows.filter(isCoverable);

  function toggleSelected(row: DelinquencyAdminQueueRow) {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(row.publicId)) next.delete(row.publicId);
      else next.add(row.publicId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(
      selectedRows.length === coverableRows.length
        ? new Set()
        : new Set(coverableRows.map((row) => row.publicId)),
    );
  }

  async function verify(row: DelinquencyAdminQueueRow) {
    setBusy(true);
    try {
      report(
        outcomeForResult({
          action: DEFAULT_ACTION.VERIFY,
          result: await verifyDefault({ noticePublicId: row.publicId }),
        }),
      );
    } catch (error) {
      report(outcomeForThrown(error));
    } finally {
      setBusy(false);
    }
  }

  function openCover(targets: readonly DelinquencyAdminQueueRow[]) {
    if (targets.length === 0) return;
    setCoverTargets(targets);
    setCoverNote("");
  }

  async function confirmCover() {
    const targets = coverTargets;
    const [first] = targets;
    if (!first) return;
    const note = coverNote.trim() || undefined;

    setBusy(true);
    try {
      const outcome = outcomeForResult({
        action: DEFAULT_ACTION.COVER,
        result:
          targets.length === 1
            ? await recordCover({ noticePublicId: first.publicId, note })
            : await recordCoverBatch({
                noticePublicIds: targets.map((row) => row.publicId),
                note,
              }),
      });
      report(outcome);
      if (outcome.kind === "success") {
        setCoverTargets([]);
        setSelectedIds(new Set());
      }
    } catch (error) {
      report(outcomeForThrown(error));
    } finally {
      setBusy(false);
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

    setBusy(true);
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
      setBusy(false);
    }
  }

  const [singleTarget] = coverTargets;
  const singlePreview: CoverPreview | null =
    coverTargets.length === 1 && singleTarget
      ? coverPreview({
          requestedCents: singleTarget.updatedAmountCents,
          capacity: singleTarget.guaranteeCapacity,
        })
      : null;
  const totals: BatchCoverPreview = batchCoverPreview(
    coverTargets.map((row) => ({
      guaranteeId: row.guaranteeId,
      requestedCents: row.updatedAmountCents,
      capacity: row.guaranteeCapacity,
    })),
  );

  return {
    rows,
    isDone: result.isDone,
    now,
    busy,
    verify,
    selection: {
      isSelected: (row: DelinquencyAdminQueueRow) => selectedIds.has(row.publicId),
      toggle: toggleSelected,
      toggleAll,
      clear: () => setSelectedIds(new Set()),
      rows: selectedRows,
      hasCoverable: coverableRows.length > 0,
      allSelected: coverableRows.length > 0 && selectedRows.length === coverableRows.length,
    },
    cover: {
      targets: coverTargets,
      isOpen: coverTargets.length > 0,
      close: () => setCoverTargets([]),
      openOne: (row: DelinquencyAdminQueueRow) => openCover([row]),
      openSelected: () => openCover(selectedRows),
      note: coverNote,
      setNote: setCoverNote,
      singlePreview,
      totals,
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
