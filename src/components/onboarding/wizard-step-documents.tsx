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

const DOCUMENT_KINDS = ["documento_empresa", "responsavel_id"] as const;

type DocumentKind = (typeof DOCUMENT_KINDS)[number];
type UploadStatus = "idle" | "uploading" | "error";

const INITIAL_STATUS: Record<DocumentKind, UploadStatus> = {
  documento_empresa: "idle",
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
    const docs = existingDocs ?? [];
    const map = new Map<DocumentKind, (typeof docs)[number]>();
    for (const doc of docs) map.set(doc.kind as DocumentKind, doc);
    return map;
  }, [existingDocs]);

  const allUploaded = DOCUMENT_KINDS.every((k) => uploadedKinds.has(k));

  const labels = React.useMemo(
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

  const triggerUpload = (kind: DocumentKind) => {
    fileInputRefs.current[kind]?.click();
  };

  const isAnyUploading = Object.values(uploadStatus).some((s) => s === "uploading");

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, kind: DocumentKind) => {
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
      const storageId = (body as { storageId: Id<"_storage"> }).storageId;
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
          const existingDoc = existingDocsByKind.get(kind);

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

      {DOCUMENT_KINDS.map((kind) => (
        <input
          key={kind}
          ref={(el) => {
            fileInputRefs.current[kind] = el;
          }}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => handleFileChange(e, kind)}
        />
      ))}

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
        <Button variant="outline" onClick={onBack} disabled={isAnyUploading}>
          {t("backButton")}
        </Button>
        <Button onClick={handleNext} disabled={isAnyUploading}>
          {t("nextButton")}
        </Button>
      </div>
    </div>
  );
}
