"use client";

import { useTranslations } from "next-intl";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { cn } from "@/lib/utils";
import { DOCUMENT_KINDS, useStepDocuments } from "@/components/onboarding/use-step-documents";

// Documents step is structurally different from the form-shaped steps
// (step1/banking/review): uploads are server-side state (storageId), not
// form state. Hence no RHF, no zod schema, no SAVE_* action — the step
// just calls onNext() once every required upload has landed.
type Props = {
  agencyId: AgencyId;
  onNext: () => void;
  onBack: () => void;
};

export function StepDocuments({ agencyId, onNext, onBack }: Props) {
  const t = useTranslations("onboarding.documents");
  const vm = useStepDocuments({ agencyId, onNext });

  if (vm.isLoading) {
    return <div className="text-text-3 py-8 text-center font-mono text-sm">{t("loading")}</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-text-2 text-sm">{t("subtitle")}</p>

      <div className="flex flex-col gap-2">
        {DOCUMENT_KINDS.map((kind) => {
          const isDone = vm.uploadedKinds.has(kind);
          const status = vm.uploadStatus[kind];
          const existingDoc = vm.existingDocsByKind.get(kind);

          return (
            <div
              key={kind}
              className={cn(
                "flex items-center justify-between gap-4 border px-4 py-3",
                isDone ? "border-accent/40 bg-accent/5" : "border-border",
              )}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-text text-sm font-medium">{vm.labels[kind].label}</span>
                {isDone && existingDoc ? (
                  <span className="text-text-3 truncate text-xs">{existingDoc.fileName}</span>
                ) : (
                  <span className="text-text-3 text-xs">{vm.labels[kind].description}</span>
                )}
              </div>

              <div className="shrink-0">
                {status === "uploading" ? (
                  <span className="text-muted-foreground text-xs">{t("uploading")}</span>
                ) : isDone ? (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => vm.triggerUpload(kind)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t("replaceButton")}
                  </Button>
                ) : status === "error" ? (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => vm.triggerUpload(kind)}
                    className="text-destructive"
                  >
                    {t("retryButton")}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    size="xs"
                    onClick={() => vm.triggerUpload(kind)}
                  >
                    {t("uploadButton")}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {DOCUMENT_KINDS.map((kind) => (
        <input
          key={kind}
          ref={vm.setRef(kind)}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => vm.handleFileChange(e, kind)}
        />
      ))}

      {vm.uploadedKinds.size > 0 && (
        <p className="text-text-3 text-xs" role="status">
          {t("progress", { uploaded: vm.uploadedKinds.size, total: DOCUMENT_KINDS.length })}
        </p>
      )}

      {vm.showValidationError && !vm.allUploaded && (
        <p className="text-error text-xs" role="alert">
          {t("allRequired")}
        </p>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} disabled={vm.isAnyUploading}>
          {t("backButton")}
        </Button>
        <Button onClick={vm.handleNext} disabled={vm.isAnyUploading}>
          {t("nextButton")}
        </Button>
      </div>
    </div>
  );
}
