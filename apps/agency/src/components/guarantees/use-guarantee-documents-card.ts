"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import type { DocumentKey, GuaranteeDocumentId, GuaranteeState } from "@convex/guarantees/domain";
import type { StorageId } from "@convex/lib/storage";
import { postFileToStorage } from "@mutav/app-shell/storage-upload";

export type GuaranteeDocumentRow = NonNullable<
  FunctionReturnType<typeof api.guarantees.documents.listGuaranteeDocuments>
>[number];

/** Slot order on the card: the signed contract gates activation, so it leads. */
export const DOCUMENT_SLOTS = [
  "rentalContract",
  "inspection",
  "policy",
] as const satisfies readonly DocumentKey[];

export const SLOTS_WITH_TEMPLATE: ReadonlySet<DocumentKey> = new Set([
  "rentalContract",
  "inspection",
]);

/** Mirrors the server-side allowlist; the server re-checks against storage metadata. */
export const ACCEPTED_FILE_TYPES = "application/pdf,image/jpeg,image/png";

const UPLOAD_FAILED_CODE = "UPLOAD_FAILED";

function isStorageId(value: string): value is StorageId {
  return value.length > 0;
}

type UseGuaranteeDocumentsCardArgs = {
  publicId: string;
  agencyId: AgencyId;
  guaranteeStatus: GuaranteeState;
};

export function useGuaranteeDocumentsCard({
  publicId,
  agencyId,
  guaranteeStatus,
}: UseGuaranteeDocumentsCardArgs) {
  const t = useTranslations("guaranteeDetails.documents");
  const convex = useConvex();
  const documents = useQuery(api.guarantees.documents.listGuaranteeDocuments, { publicId });
  const generateUploadUrl = useMutation(
    api.guarantees.documents.generateGuaranteeDocumentUploadUrl,
  );
  const attachDocument = useMutation(api.guarantees.documents.attachGuaranteeDocument);

  const [uploadingKey, setUploadingKey] = React.useState<DocumentKey | null>(null);
  const fileInputs = React.useRef<Partial<Record<DocumentKey, HTMLInputElement | null>>>({});

  const canUpload = guaranteeStatus !== "closed";

  const documentsByKey = React.useMemo(() => {
    const grouped = new Map<DocumentKey, GuaranteeDocumentRow[]>();
    for (const document of documents ?? []) {
      grouped.set(document.key, [...(grouped.get(document.key) ?? []), document]);
    }
    return grouped;
  }, [documents]);

  const setInputRef = React.useCallback(
    (key: DocumentKey) => (element: HTMLInputElement | null) => {
      fileInputs.current[key] = element;
    },
    [],
  );

  const chooseFile = React.useCallback((key: DocumentKey) => {
    fileInputs.current[key]?.click();
  }, []);

  const reportError = React.useCallback(
    (code: string) => {
      toast.error(
        t.has(`errors.${code}`) ? t(`errors.${code}`) : t(`errors.${UPLOAD_FAILED_CODE}`),
      );
    },
    [t],
  );

  const uploadFile = React.useCallback(
    async (key: DocumentKey, event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      setUploadingKey(key);
      try {
        const minted = await generateUploadUrl({ agencyId, publicId });
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
        const attached = await attachDocument({
          agencyId,
          publicId,
          key,
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
        setUploadingKey(null);
      }
    },
    [agencyId, attachDocument, generateUploadUrl, publicId, reportError, t],
  );

  const download = React.useCallback(
    async (documentId: GuaranteeDocumentId) => {
      const url = await convex.query(api.guarantees.documents.getGuaranteeDocumentUrl, {
        documentId,
      });
      if (!url) {
        reportError("DOCUMENT_NOT_FOUND");
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [convex, reportError],
  );

  return {
    isLoading: documents === undefined,
    canUpload,
    uploadingKey,
    documentsByKey,
    setInputRef,
    chooseFile,
    uploadFile,
    download,
  };
}
