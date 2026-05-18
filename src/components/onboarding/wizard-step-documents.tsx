"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  agencyId: Id<"agencies">;
  onNext: () => void;
  onBack: () => void;
};

const DOCUMENT_KINDS = [
  "cartao_cnpj",
  "contrato_social",
  "comprovante_endereco",
  "responsavel_id",
] as const;

type DocumentKind = (typeof DOCUMENT_KINDS)[number];
type UploadStatus = "idle" | "uploading" | "error";

const INITIAL_STATUS: Record<DocumentKind, UploadStatus> = {
  cartao_cnpj: "idle",
  contrato_social: "idle",
  comprovante_endereco: "idle",
  responsavel_id: "idle",
};

export function WizardStepDocuments({ agencyId, onNext, onBack }: Props) {
  const t = useTranslations("onboarding.wizard.documents");

  const existingDocs = useQuery(api.agencies.useCases.listDocumentsForAgency, { agencyId });
  const generateUploadUrl = useMutation(api.agencies.useCases.generateDocumentUploadUrl);
  const saveDoc = useMutation(api.agencies.useCases.saveDocument);

  const [uploadStatus, setUploadStatus] =
    React.useState<Record<DocumentKind, UploadStatus>>(INITIAL_STATUS);
  const [showValidationError, setShowValidationError] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingKindRef = React.useRef<DocumentKind | null>(null);

  const uploadedKinds = React.useMemo(
    () => new Set(existingDocs?.map((d) => d.kind) ?? []),
    [existingDocs],
  );

  const allUploaded = DOCUMENT_KINDS.every((k) => uploadedKinds.has(k));

  const labels = React.useMemo(
    () => ({
      cartao_cnpj: {
        label: t("kinds.cartao_cnpj.label"),
        description: t("kinds.cartao_cnpj.description"),
      },
      contrato_social: {
        label: t("kinds.contrato_social.label"),
        description: t("kinds.contrato_social.description"),
      },
      comprovante_endereco: {
        label: t("kinds.comprovante_endereco.label"),
        description: t("kinds.comprovante_endereco.description"),
      },
      responsavel_id: {
        label: t("kinds.responsavel_id.label"),
        description: t("kinds.responsavel_id.description"),
      },
    }),
    [t],
  );

  const triggerUpload = (kind: DocumentKind) => {
    pendingKindRef.current = kind;
    fileInputRef.current?.click();
  };

  const isAnyUploading = Object.values(uploadStatus).some((s) => s === "uploading");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const kind = pendingKindRef.current;
    e.target.value = "";
    pendingKindRef.current = null;

    if (!file || !kind) return;

    setUploadStatus((s) => ({ ...s, [kind]: "uploading" }));
    try {
      const uploadUrl = await generateUploadUrl();
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("upload_failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const result = await saveDoc({ agencyId, kind, storageId, fileName: file.name });
      if (!result.success) throw new Error(result.error.code);
      setUploadStatus((s) => ({ ...s, [kind]: "idle" }));
    } catch {
      setUploadStatus((s) => ({ ...s, [kind]: "error" }));
    }
  };

  const handleNext = () => {
    if (!allUploaded) {
      setShowValidationError(true);
      return;
    }
    setShowValidationError(false);
    onNext();
  };

  if (existingDocs === undefined) {
    return <div className="text-text-3 py-8 text-center font-mono text-sm">{t("loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-text-2 text-sm">{t("subtitle")}</p>

      <div className="flex flex-col gap-2">
        {DOCUMENT_KINDS.map((kind) => {
          const isDone = uploadedKinds.has(kind);
          const status = uploadStatus[kind];
          const existingDoc = existingDocs.find((d) => d.kind === kind);

          return (
            <div
              key={kind}
              className={cn(
                "flex items-center justify-between gap-4 border px-4 py-3",
                isDone ? "border-accent/40 bg-accent/5" : "border-border",
              )}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-text text-sm font-medium">{labels[kind].label}</span>
                {isDone && existingDoc ? (
                  <span className="text-text-3 truncate text-xs">{existingDoc.fileName}</span>
                ) : (
                  <span className="text-text-3 text-xs">{labels[kind].description}</span>
                )}
              </div>

              <div className="shrink-0">
                {status === "uploading" ? (
                  <span className="text-text-3 font-mono text-xs">{t("uploading")}</span>
                ) : isDone ? (
                  <button
                    type="button"
                    onClick={() => triggerUpload(kind)}
                    className="text-text-3 hover:text-text font-mono text-xs"
                  >
                    {t("replaceButton")}
                  </button>
                ) : status === "error" ? (
                  <button
                    type="button"
                    onClick={() => triggerUpload(kind)}
                    className="text-error font-mono text-xs hover:opacity-80"
                  >
                    {t("retryButton")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => triggerUpload(kind)}
                    className="text-accent font-mono text-xs hover:opacity-80"
                  >
                    {t("uploadButton")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={handleFileChange}
      />

      {uploadedKinds.size > 0 && (
        <p className="text-text-3 text-xs" role="status">
          {t("progress", { uploaded: uploadedKinds.size, total: DOCUMENT_KINDS.length })}
        </p>
      )}

      {showValidationError && !allUploaded && (
        <p className="text-error text-xs" role="alert">
          {t("allRequired")}
        </p>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isAnyUploading}
          className="text-text-2 hover:text-text font-mono text-sm disabled:opacity-50"
        >
          {t("backButton")}
        </button>
        <Button onClick={handleNext} disabled={isAnyUploading}>
          {t("nextButton")}
        </Button>
      </div>
    </div>
  );
}
