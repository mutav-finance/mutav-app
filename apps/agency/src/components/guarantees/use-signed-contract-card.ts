"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import {
  GUARANTEE_STATE,
  SIGNED_CONTRACT_CONTENT_TYPE,
  SIGNED_CONTRACT_MAX_BYTES,
  type GuaranteeState,
} from "@convex/guarantees/domain";
import { postToUploadUrl } from "@/lib/storage-upload";

const UPLOAD_FAILED = "UPLOAD_FAILED";
const UNEXPECTED = "UNEXPECTED";

/** Same rule the server enforces; checked here only to fail fast before uploading. */
function precheckFile(file: File): string | null {
  if (file.type !== SIGNED_CONTRACT_CONTENT_TYPE) return "INVALID_FILE_TYPE";
  if (file.size === 0 || file.size > SIGNED_CONTRACT_MAX_BYTES) return "FILE_TOO_LARGE";
  return null;
}

export function useSignedContractCard({
  agencyId,
  publicId,
  status,
}: {
  agencyId: AgencyId;
  publicId: string;
  status: GuaranteeState;
}) {
  const t = useTranslations("guaranteeDetails.signedContract");
  const contract = useQuery(api.guarantees.signedContracts.get, { agencyId, publicId });
  const generateUploadUrl = useMutation(api.guarantees.signedContracts.generateUploadUrl);
  const attach = useMutation(api.guarantees.signedContracts.attach);
  const activate = useMutation(api.guarantees.mutations.activate);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isActivating, setIsActivating] = React.useState(false);
  const [activateOpen, setActivateOpen] = React.useState(false);

  const isDrafted = status === GUARANTEE_STATE.DRAFTED;
  const hasContract = contract !== undefined && contract !== null;
  const canActivate = isDrafted && hasContract;

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
        const minted = await generateUploadUrl({ agencyId, publicId });
        if (!minted.success) {
          showError(minted.error.code);
          return;
        }
        const storageId = await postToUploadUrl({ uploadUrl: minted.data.uploadUrl, file });
        if (!storageId) {
          showError(UPLOAD_FAILED);
          return;
        }
        const result = await attach({ agencyId, publicId, storageId, fileName: file.name });
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
    [agencyId, publicId, generateUploadUrl, attach, showError, t],
  );

  const confirmActivate = React.useCallback(async () => {
    setIsActivating(true);
    try {
      const result = await activate({ agencyId, publicId });
      if (!result.success) {
        showError(result.error.code);
        return;
      }
      setActivateOpen(false);
      toast.success(t("activated"));
    } catch {
      showError(UNEXPECTED);
    } finally {
      setIsActivating(false);
    }
  }, [agencyId, publicId, activate, showError, t]);

  return {
    contract,
    isLoading: contract === undefined,
    isDrafted,
    canActivate,
    isUploading,
    isActivating,
    activateOpen,
    setActivateOpen,
    fileInputRef,
    openFilePicker,
    handleFileChange,
    confirmActivate,
  };
}
