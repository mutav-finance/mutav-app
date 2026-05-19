"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgencyId, AgencyDocument } from "@convex/agencies/domain";
import type { StorageId } from "@convex/lib/storage";

export const DOCUMENT_KINDS = ["documento_empresa", "responsavel_id"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export type UploadStatus = "idle" | "uploading" | "error";

const INITIAL_STATUS: Record<DocumentKind, UploadStatus> = {
  documento_empresa: "idle",
  responsavel_id: "idle",
};

type Labels = Record<DocumentKind, { label: string; description: string }>;

export function useStepDocuments({ agencyId, onNext }: { agencyId: AgencyId; onNext: () => void }) {
  const t = useTranslations("onboarding.documents");

  const existingDocs = useQuery(api.agencies.useCases.listDocumentsForAgency, { agencyId });
  const generateUploadUrl = useMutation(api.agencies.useCases.generateDocumentUploadUrl);
  const saveDoc = useMutation(api.agencies.useCases.saveDocument);

  const [uploadStatus, setUploadStatus] =
    React.useState<Record<DocumentKind, UploadStatus>>(INITIAL_STATUS);
  const [showValidationError, setShowValidationError] = React.useState(false);

  // One ref per document kind — eliminates the race condition that arises from
  // sharing a single input + pendingKindRef between concurrent clicks.
  const fileInputRefs = React.useRef<Record<DocumentKind, HTMLInputElement | null>>({
    documento_empresa: null,
    responsavel_id: null,
  });

  const uploadedKinds = React.useMemo(
    () => new Set(existingDocs?.map((d) => d.kind) ?? []),
    [existingDocs],
  );

  const existingDocsByKind = React.useMemo(() => {
    const map = new Map<DocumentKind, AgencyDocument>();
    for (const doc of existingDocs ?? []) map.set(doc.kind, doc);
    return map;
  }, [existingDocs]);

  const allUploaded = DOCUMENT_KINDS.every((k) => uploadedKinds.has(k));
  const isAnyUploading = Object.values(uploadStatus).some((s) => s === "uploading");
  const isLoading = existingDocs === undefined;

  const labels: Labels = React.useMemo(
    () => ({
      documento_empresa: {
        label: t("kinds.documento_empresa.label"),
        description: t("kinds.documento_empresa.description"),
      },
      responsavel_id: {
        label: t("kinds.responsavel_id.label"),
        description: t("kinds.responsavel_id.description"),
      },
    }),
    [t],
  );

  const setRef = React.useCallback(
    (kind: DocumentKind) => (el: HTMLInputElement | null) => {
      fileInputRefs.current[kind] = el;
    },
    [],
  );

  const triggerUpload = React.useCallback((kind: DocumentKind) => {
    fileInputRefs.current[kind]?.click();
  }, []);

  const handleFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, kind: DocumentKind) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      setUploadStatus((s) => ({ ...s, [kind]: "uploading" }));
      try {
        const urlResult = await generateUploadUrl({ agencyId });
        if (!urlResult.success) throw new Error(urlResult.error.code);
        const res = await fetch(urlResult.data.url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error("upload_failed");
        // External API boundary — validate shape before using.
        const body: unknown = await res.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("storageId" in body) ||
          typeof (body as Record<string, unknown>).storageId !== "string"
        ) {
          throw new Error("upload_failed");
        }
        const storageId = (body as { storageId: StorageId }).storageId;
        const result = await saveDoc({ agencyId, kind, storageId, fileName: file.name });
        if (!result.success) throw new Error(result.error.code);
        setUploadStatus((s) => ({ ...s, [kind]: "idle" }));
      } catch {
        setUploadStatus((s) => ({ ...s, [kind]: "error" }));
      }
    },
    [agencyId, generateUploadUrl, saveDoc],
  );

  const handleNext = React.useCallback(() => {
    if (!allUploaded) {
      setShowValidationError(true);
      return;
    }
    setShowValidationError(false);
    onNext();
  }, [allUploaded, onNext]);

  return {
    isLoading,
    uploadStatus,
    uploadedKinds,
    existingDocsByKind,
    allUploaded,
    isAnyUploading,
    showValidationError,
    labels,
    setRef,
    triggerUpload,
    handleFileChange,
    handleNext,
  };
}
