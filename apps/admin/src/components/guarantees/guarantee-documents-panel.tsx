"use client";

import { DownloadIcon, FileTextIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDateTimeBR } from "@mutav/i18n/brazil";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { StatusTag } from "@mutav/ui/guarantee-state-tag";
import {
  ACCEPTED_FILE_TYPES,
  DOCUMENT_SLOTS,
  DOCUMENT_STATUS_TONE,
  formatFileSize,
} from "@/components/documents/view-model";
import { RejectDocumentDialog } from "@/components/documents/reject-document-dialog";
import {
  useGuaranteeDocumentsPanel,
  type StaffGuaranteeDocument,
} from "@/hooks/use-guarantee-documents-panel";
import type { DocumentReviewViewModel } from "@/hooks/use-document-review";

/**
 * Every document attached to one guarantee, grouped by slot, with staff
 * upload and review. Standalone so a guarantee detail page can embed it by
 * publicId.
 */
export function GuaranteeDocumentsPanel({ publicId }: { publicId: string }) {
  const t = useTranslations("guaranteeDocuments");
  const view = useGuaranteeDocumentsPanel({ publicId });

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("panel.heading")}
        </Eyebrow>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {view.isMissing ? (
          <p className="text-muted-foreground text-base-sm">{t("panel.notFound")}</p>
        ) : (
          DOCUMENT_SLOTS.map((key) => {
            const files = view.documentsFor(key);
            const isUploading = view.uploadingKey === key;
            return (
              <div key={key} className="border-border flex flex-col gap-3 rounded border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileTextIcon
                      className="text-muted-foreground size-4"
                      strokeWidth={1.25}
                      aria-hidden
                    />
                    <span className="text-base-sm font-medium">{t(`labels.${key}`)}</span>
                  </div>
                  <input
                    ref={view.setInputRef(key)}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    className="hidden"
                    aria-label={t("panel.chooseFile", { document: t(`labels.${key}`) })}
                    onChange={(event) => view.uploadFile(key, event)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!view.canUpload || view.uploadingKey !== null}
                    onClick={() => view.chooseFile(key)}
                  >
                    {isUploading ? (
                      <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden />
                    ) : (
                      <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                    )}
                    {isUploading ? t("panel.uploading") : t("panel.upload")}
                  </Button>
                </div>
                {files.length === 0 ? (
                  <p className="text-muted-foreground text-base-sm">
                    {view.isLoading ? t("panel.loading") : t("panel.empty")}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {files.map((file) => (
                      <PanelFileRow key={file.id} file={file} review={view.review} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </CardContent>
      <RejectDocumentDialog review={view.review} />
    </Card>
  );
}

function PanelFileRow({
  file,
  review,
}: {
  file: StaffGuaranteeDocument;
  review: DocumentReviewViewModel;
}) {
  const t = useTranslations("guaranteeDocuments");
  const uploader = file.uploadedBy.name ?? t("unknownUser");
  const target = { id: file.id, fileName: file.fileName };

  return (
    <li className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="link"
          size="sm"
          className="h-auto max-w-full p-0"
          onClick={() => review.download(file.id)}
        >
          <DownloadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
          <span className="truncate">{file.fileName}</span>
        </Button>
        <StatusTag tone={DOCUMENT_STATUS_TONE[file.status]}>{t(`status.${file.status}`)}</StatusTag>
      </div>
      <span className="text-muted-foreground text-base-sm">
        {t(`uploadedBy.${file.uploadedBy.kind}`, {
          name: uploader,
          date: formatDateTimeBR(file.uploadedAt),
          size: formatFileSize(file.sizeBytes),
        })}
      </span>
      {file.reviewedAt && (
        <span className="text-muted-foreground text-base-sm">
          {t("reviewedBy", {
            name: file.reviewedByName ?? t("unknownUser"),
            date: formatDateTimeBR(file.reviewedAt),
          })}
        </span>
      )}
      {file.rejectionReason && (
        <span className="text-destructive text-base-sm">
          {t("rejectionReason", { reason: file.rejectionReason })}
        </span>
      )}
      {file.status === "pending_review" && (
        <div className="flex gap-2 pt-1">
          <Button size="sm" disabled={review.busy} onClick={() => review.approve(target)}>
            {t("actions.approve")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={review.busy}
            onClick={() => review.reject.open(target)}
          >
            {t("actions.reject")}
          </Button>
        </div>
      )}
    </li>
  );
}
