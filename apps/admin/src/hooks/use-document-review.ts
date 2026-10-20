"use client";

import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { GuaranteeDocumentId } from "@convex/guarantees/domain";
import {
  canSubmitRejection,
  errorMessageKey,
  thrownMessageKey,
} from "@/components/documents/view-model";

export type ReviewTarget = { id: GuaranteeDocumentId; fileName: string };

/**
 * Approve / reject / download for one guarantee document, shared by the
 * review queue and the per-guarantee panel. Owns the reject dialog and the
 * in-flight flag; message-key decisions live in the pure view-model.
 */
export function useDocumentReview() {
  const t = useTranslations("guaranteeDocuments");
  const convex = useConvex();
  const approveMutation = useMutation(api.guarantees.staffDocuments.approveGuaranteeDocument);
  const rejectMutation = useMutation(api.guarantees.staffDocuments.rejectGuaranteeDocument);

  const [busy, setBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<ReviewTarget | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function approve(target: ReviewTarget) {
    setBusy(true);
    try {
      const result = await approveMutation({ documentId: target.id });
      if (!result.success) toast.error(t(errorMessageKey(result.error.code)));
      else if (result.data.reviewSigned) toast.success(t("toast.approvedAndSigned"));
      else toast.success(t("toast.approved"));
    } catch (error) {
      toast.error(t(thrownMessageKey(error)));
    } finally {
      setBusy(false);
    }
  }

  function openReject(target: ReviewTarget) {
    setRejectTarget(target);
    setRejectReason("");
  }

  async function confirmReject() {
    const target = rejectTarget;
    if (!target || !canSubmitRejection(rejectReason)) return;
    setBusy(true);
    try {
      const result = await rejectMutation({ documentId: target.id, reason: rejectReason });
      if (result.success) {
        toast.success(t("toast.rejected"));
        setRejectTarget(null);
      } else {
        toast.error(t(errorMessageKey(result.error.code)));
      }
    } catch (error) {
      toast.error(t(thrownMessageKey(error)));
    } finally {
      setBusy(false);
    }
  }

  async function download(documentId: GuaranteeDocumentId) {
    try {
      const url = await convex.query(api.guarantees.staffDocuments.getStaffGuaranteeDocumentUrl, {
        documentId,
      });
      if (!url) {
        toast.error(t(errorMessageKey("DOCUMENT_NOT_FOUND")));
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(t(thrownMessageKey(error)));
    }
  }

  return {
    busy,
    approve,
    download,
    reject: {
      target: rejectTarget,
      open: openReject,
      close: () => setRejectTarget(null),
      reason: rejectReason,
      setReason: setRejectReason,
      canSubmit: canSubmitRejection(rejectReason),
      confirm: confirmReject,
    },
  };
}

export type DocumentReviewViewModel = ReturnType<typeof useDocumentReview>;
