"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { SIGNED_CONTRACT_CONTENT_TYPE, SIGNED_CONTRACT_MAX_BYTES } from "@convex/guarantees/domain";
import { postToUploadUrl } from "@/lib/storage-upload";

const UPLOAD_FAILED = "UPLOAD_FAILED";
const UNEXPECTED = "UNEXPECTED";

/** Same rule the server enforces; checked here only to fail fast before uploading. */
function precheckFile(file: File): string | null {
  if (file.type !== SIGNED_CONTRACT_CONTENT_TYPE) return "INVALID_FILE_TYPE";
  if (file.size === 0 || file.size > SIGNED_CONTRACT_MAX_BYTES) return "FILE_TOO_LARGE";
  return null;
}

/** Staff upload / replace of a guarantee's signed contract. Staff never activate. */
export function useStaffSignedContract({ publicId }: { publicId: string }) {
  const t = useTranslations("guarantees.signedContract");
  const generateUploadUrl = useMutation(api.guarantees.signedContracts.staffGenerateUploadUrl);
  const attach = useMutation(api.guarantees.signedContracts.staffAttach);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);

  const showError = React.useCallback(
    (code: string) => {
      const key = `errors.${code}`;
      toast.error(t.has(key) ? t(key) : t(`errors.${UNEXPECTED}`));
    },
    [t],
  );

  const openFilePicker = React.useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChange = React.useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;

      const precheck = precheckFile(file);
      if (precheck) {
        showError(precheck);
        return;
      }

      setIsUploading(true);
      try {
        const minted = await generateUploadUrl({ publicId });
        if (!minted.success) {
          showError(minted.error.code);
          return;
        }
        const storageId = await postToUploadUrl({ uploadUrl: minted.data.uploadUrl, file });
        if (!storageId) {
          showError(UPLOAD_FAILED);
          return;
        }
        const result = await attach({ publicId, storageId, fileName: file.name });
        if (!result.success) {
          showError(result.error.code);
          return;
        }
        toast.success(result.data.replaced ? t("replaced") : t("uploaded"));
      } catch {
        showError(UNEXPECTED);
      } finally {
        setIsUploading(false);
      }
    },
    [publicId, generateUploadUrl, attach, showError, t],
  );

  return { fileInputRef, isUploading, openFilePicker, handleFileChange };
}
