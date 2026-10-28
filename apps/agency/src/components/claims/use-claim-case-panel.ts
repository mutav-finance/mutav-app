"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import {
  AGENCY_CASE_STATUS,
  CLAIM_EVIDENCE_KINDS,
  CLAIM_EVIDENCE_STATUS,
  brazilToday,
  type ClaimEvidenceId,
  type ClaimEvidenceKind,
} from "@convex/delinquencies/domain";
import type { StorageId } from "@convex/lib/storage";
import { postFileToStorage } from "@mutav/app-shell/storage-upload";
import { parseAmountToCents } from "@/lib/currency/parse";
import { caseEvents, caseStep, liveCaseStatus } from "@/lib/claims/case-view";

export type ClaimCaseDetail = NonNullable<
  FunctionReturnType<typeof api.delinquencies.useCases.getByPublicId>
>;
export type ClaimEvidenceFile = ClaimCaseDetail["evidence"][number];
export type ClaimRequest = NonNullable<ClaimCaseDetail["claim"]>["requests"][number];

const UPLOAD_FAILED_CODE = "UPLOAD_FAILED";

function isStorageId(value: string): value is StorageId {
  return value.length > 0;
}

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** Newest file per kind that still counts (not superseded). */
function latestByKind(evidence: readonly ClaimEvidenceFile[]) {
  const latest = new Map<ClaimEvidenceKind, ClaimEvidenceFile>();
  for (const file of evidence) {
    if (file.status === CLAIM_EVIDENCE_STATUS.SUPERSEDED) continue;
    const current = latest.get(file.kind);
    if (!current || Date.parse(file.uploadedAt) > Date.parse(current.uploadedAt)) {
      latest.set(file.kind, file);
    }
  }
  return latest;
}

/**
 * View model for the case panel: one late-rent case, whichever state it is
 * in. The panel's layout is fixed; this decides what each slot says and which
 * actions exist right now.
 */
export function useClaimCasePanel({
  publicId,
  onClosed,
}: {
  publicId: string;
  onClosed?: () => void;
}) {
  const t = useTranslations("claims.panel");
  const convex = useConvex();
  const detail = useQuery(api.delinquencies.useCases.getByPublicId, { publicId });
  const generateUploadUrl = useMutation(
    api.delinquencies.claimEvidence.generateClaimEvidenceUploadUrl,
  );
  const attachEvidence = useMutation(api.delinquencies.claimEvidence.attachClaimEvidence);
  const submitClaim = useMutation(api.delinquencies.claims.submitClaim);
  const resubmitClaim = useMutation(api.delinquencies.claims.resubmitClaim);
  const markResolved = useMutation(api.delinquencies.mutations.markResolved);
  const markCanceled = useMutation(api.delinquencies.mutations.markCanceled);

  // Fixed at mount: a case should not change status under the agency while
  // the panel is open across midnight.
  const [today] = React.useState(() => brazilToday(Date.now()));
  const [uploadingKind, setUploadingKind] = React.useState<ClaimEvidenceKind | null>(null);
  const [declared, setDeclared] = React.useState(false);
  const [amountChoice, setAmountChoice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const reportError = React.useCallback(
    (code: string) => {
      toast.error(
        t.has(`errors.${code}`) ? t(`errors.${code}`) : t(`errors.${UPLOAD_FAILED_CODE}`),
      );
    },
    [t],
  );

  const upload = React.useCallback(
    async (kind: ClaimEvidenceKind, file: File) => {
      setUploadingKind(kind);
      try {
        const minted = await generateUploadUrl({ noticePublicId: publicId });
        if (!minted.success) {
          reportError(minted.error.code);
          return;
        }
        const storageId = await postFileToStorage({
          uploadUrl: minted.data.url,
          file,
          isStorageId,
        });
        if (!storageId) {
          reportError(UPLOAD_FAILED_CODE);
          return;
        }
        const attached = await attachEvidence({
          noticePublicId: publicId,
          kind,
          storageId,
          fileName: file.name,
        });
        if (!attached.success) {
          reportError(attached.error.code);
          return;
        }
        toast.success(t("uploaded"));
      } catch {
        reportError(UPLOAD_FAILED_CODE);
      } finally {
        setUploadingKind(null);
      }
    },
    [attachEvidence, generateUploadUrl, publicId, reportError, t],
  );

  const download = React.useCallback(
    async (evidenceId: ClaimEvidenceId) => {
      const url = await convex.query(api.delinquencies.claimEvidence.getClaimEvidenceUrl, {
        evidenceId,
      });
      if (!url) {
        reportError("FILE_NOT_FOUND");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [convex, reportError],
  );

  if (detail === undefined) return { kind: "loading" } as const;
  if (detail === null) return { kind: "missing" } as const;

  const status = liveCaseStatus(detail, today);
  const latest = latestByKind(detail.evidence);
  const openRequests = new Map<ClaimEvidenceKind, ClaimRequest>();
  for (const request of detail.claim?.requests ?? []) {
    if (request.resolvedAt === null) openRequests.set(request.evidenceKind, request);
  }
  const canEditEvidence =
    status === AGENCY_CASE_STATUS.REPORTED ||
    status === AGENCY_CASE_STATUS.READY_TO_CLAIM ||
    status === AGENCY_CASE_STATUS.INFO_REQUESTED;

  const amountInput = amountChoice ?? centsToInput(detail.originalAmountCents);
  const amountCents = parseAmountToCents(amountInput);
  const missing = [
    ...detail.missingRequirements.filter((requirement) => requirement !== "signedContract"),
    ...(declared ? [] : (["declaration"] as const)),
  ];
  const canSubmit =
    status === AGENCY_CASE_STATUS.READY_TO_CLAIM &&
    !detail.missingRequirements.includes("signedContract") &&
    missing.length === 0 &&
    amountCents !== null &&
    amountCents <= detail.originalAmountCents;
  const canResubmit = status === AGENCY_CASE_STATUS.INFO_REQUESTED && openRequests.size === 0;

  async function run(
    action: () => Promise<{ success: true } | { success: false; error: { code: string } }>,
    { success, onSuccess }: { success: string; onSuccess?: () => void },
  ) {
    setBusy(true);
    try {
      const result = await action();
      if (result.success) {
        toast.success(success);
        onSuccess?.();
      } else {
        reportError(result.error.code);
      }
    } catch {
      reportError(UPLOAD_FAILED_CODE);
    } finally {
      setBusy(false);
    }
  }

  return {
    kind: "ready",
    detail,
    today,
    status,
    step: caseStep(status),
    events: caseEvents(detail),
    evidenceKinds: CLAIM_EVIDENCE_KINDS,
    latest,
    openRequests,
    canEditEvidence,
    uploadingKind,
    upload,
    download,
    signedContractMissing: detail.missingRequirements.includes("signedContract"),
    missing,
    declared,
    setDeclared,
    amountInput,
    setAmountInput: setAmountChoice,
    canSubmit,
    canResubmit,
    busy,
    submit: () =>
      amountCents === null
        ? undefined
        : run(
            () =>
              submitClaim({
                noticePublicId: publicId,
                claimedAmountCents: amountCents,
                declarationAccepted: true,
              }),
            { success: t("submitted") },
          ),
    resubmit: () =>
      run(() => resubmitClaim({ noticePublicId: publicId }), { success: t("resubmitted") }),
    markCured: (note: string) =>
      run(
        () =>
          markResolved({
            noticePublicId: publicId,
            resolution: { kind: "tenant_cured", ...(note.trim() ? { note: note.trim() } : {}) },
          }),
        { success: t("cured"), onSuccess: onClosed },
      ),
    withdraw: (reason: "agency_withdrew" | "duplicate" | "data_error") =>
      run(() => markCanceled({ noticePublicId: publicId, cancellation: { reason } }), {
        success: t("withdrawn"),
        onSuccess: onClosed,
      }),
  } as const;
}
