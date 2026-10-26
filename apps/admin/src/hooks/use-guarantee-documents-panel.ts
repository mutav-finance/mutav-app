"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { DocumentKey } from "@convex/guarantees/domain";
import type { StorageId } from "@convex/lib/storage";
import { postFileToStorage } from "@mutav/app-shell/storage-upload";
import {
  UPLOAD_FAILED_CODE,
  errorMessageKey,
  thrownMessageKey,
} from "@/components/documents/view-model";
import { useDocumentReview } from "@/hooks/use-document-review";

export type StaffGuaranteeDocument = NonNullable<
  FunctionReturnType<typeof api.guarantees.staffDocuments.listDocumentsForGuarantee>
>["documents"][number];

function isStorageId(value: string): value is StorageId {
  return value.length > 0;
}

/**
 * View-model for the per-guarantee documents panel: the guarantee's file
 * history, a staff upload per slot (for files an agency sent by other means),
 * and the shared review actions.
 */
export function useGuaranteeDocumentsPanel({ publicId }: { publicId: string }) {
  const t = useTranslations("guaranteeDocuments");
  const result = useQuery(api.guarantees.staffDocuments.listDocumentsForGuarantee, { publicId });
  const generateUploadUrl = useMutation(api.guarantees.staffDocuments.staffGenerateUploadUrl);
  const attachDocument = useMutation(api.guarantees.staffDocuments.staffAttachGuaranteeDocument);
  const review = useDocumentReview();

  const [uploadingKey, setUploadingKey] = useState<DocumentKey | null>(null);
  const fileInputs = useRef<Partial<Record<DocumentKey, HTMLInputElement | null>>>({});

  function setInputRef(key: DocumentKey) {
    return (element: HTMLInputElement | null) => {
      fileInputs.current[key] = element;
    };
  }

  function chooseFile(key: DocumentKey) {
    fileInputs.current[key]?.click();
  }

  async function uploadFile(key: DocumentKey, event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setUploadingKey(key);
    try {
      const minted = await generateUploadUrl({ publicId });
      if (!minted.success) {
        toast.error(t(errorMessageKey(minted.error.code)));
        return;
      }
      const storageId = await postFileToStorage({
        uploadUrl: minted.data.url,
        file,
        isStorageId,
      });
      if (!storageId) {
        toast.error(t(errorMessageKey(UPLOAD_FAILED_CODE)));
        return;
      }
      const attached = await attachDocument({ publicId, key, storageId, fileName: file.name });
      if (!attached.success) {
        toast.error(t(errorMessageKey(attached.error.code)));
        return;
      }
      toast.success(t("toast.uploaded"));
    } catch (error) {
      toast.error(t(thrownMessageKey(error)));
    } finally {
      setUploadingKey(null);
    }
  }

  const documents = result?.documents ?? [];

  return {
    isLoading: result === undefined,
    isMissing: result === null,
    canUpload: result !== undefined && result !== null && result.guaranteeStatus !== "closed",
    documentsFor: (key: DocumentKey) => documents.filter((document) => document.key === key),
    uploadingKey,
    setInputRef,
    chooseFile,
    uploadFile,
    review,
  };
}
