"use client";

import { DownloadIcon, FileTextIcon, Loader2Icon, UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDateBR } from "@mutav/i18n/brazil";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";
import { StatusTag, type Tone } from "@mutav/ui/guarantee-state-tag";
import type { AgencyId } from "@convex/agencies/domain";
import type { GuaranteeDocumentStatus, GuaranteeState } from "@convex/guarantees/domain";
import {
  ACCEPTED_FILE_TYPES,
  DOCUMENT_SLOTS,
  SLOTS_WITH_TEMPLATE,
  useGuaranteeDocumentsCard,
  type GuaranteeDocumentRow,
} from "./use-guarantee-documents-card";

const STATUS_TONE: Record<GuaranteeDocumentStatus, Tone> = {
  pending_review: "accent",
  approved: "success",
  rejected: "error",
  superseded: "muted",
};

export function GuaranteeDocumentsCard({
  publicId,
  agencyId,
  guaranteeStatus,
}: {
  publicId: string;
  agencyId: AgencyId;
  guaranteeStatus: GuaranteeState;
}) {
  const t = useTranslations("guaranteeDetails.documents");
  const tLabels = useTranslations("guaranteeDetails.documents.labels");
  const view = useGuaranteeDocumentsCard({ publicId, agencyId, guaranteeStatus });

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {DOCUMENT_SLOTS.map((key) => {
          const files = view.documentsByKey.get(key) ?? [];
          const isUploading = view.uploadingKey === key;
          return (
            <div key={key} className="border-border flex flex-col gap-3 rounded border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <FileTextIcon
                    className="text-muted-foreground mt-0.5 size-4"
                    strokeWidth={1.25}
                    aria-hidden
                  />
                  <span className="text-base-sm font-medium">{tLabels(key)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={view.setInputRef(key)}
                    type="file"
                    accept={ACCEPTED_FILE_TYPES}
                    className="hidden"
                    aria-label={t("chooseFile", { document: tLabels(key) })}
                    onChange={(event) => view.uploadFile(key, event)}
                  />
                  <Button
                    variant="outline-primary"
                    size="sm"
                    disabled={!view.canUpload || view.uploadingKey !== null}
                    onClick={() => view.chooseFile(key)}
                  >
                    {isUploading ? (
                      <Loader2Icon data-icon="inline-start" className="animate-spin" aria-hidden />
                    ) : (
                      <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                    )}
                    {isUploading ? t("uploading") : t("send")}
                  </Button>
                  {SLOTS_WITH_TEMPLATE.has(key) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`/templates/${key}.pdf`} download>
                            <DownloadIcon className="size-4" strokeWidth={1.25} aria-hidden />
                            <span className="sr-only">{t("downloadTemplate")}</span>
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("downloadTemplate")}</TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>
              {files.length === 0 ? (
                <p className="text-muted-foreground text-base-sm">
                  {view.isLoading ? t("loading") : t("empty")}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {files.map((file) => (
                    <DocumentFileRow key={file.id} file={file} onDownload={view.download} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <p className="text-muted-foreground text-base-sm">
          {view.canUpload ? t("acceptedFormats") : t("closedGuarantee")}
        </p>
      </CardContent>
    </Card>
  );
}

function DocumentFileRow({
  file,
  onDownload,
}: {
  file: GuaranteeDocumentRow;
  onDownload: (documentId: GuaranteeDocumentRow["id"]) => void;
}) {
  const t = useTranslations("guaranteeDetails.documents");
  const tStatus = useTranslations("guaranteeDetails.documents.status");
  const uploader =
    file.uploadedBy.kind === "staff"
      ? t("uploadedByMutav")
      : (file.uploadedBy.name ?? t("unknownUser"));

  return (
    <li className="flex flex-col gap-1 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="link"
          size="sm"
          className="h-auto max-w-full truncate p-0"
          onClick={() => onDownload(file.id)}
        >
          <DownloadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
          <span className="truncate">{file.fileName}</span>
        </Button>
        <StatusTag tone={STATUS_TONE[file.status]}>{tStatus(file.status)}</StatusTag>
      </div>
      <span className="text-muted-foreground text-base-sm">
        {t("uploadedBy", { name: uploader, date: formatDateBR(file.uploadedAt) })}
      </span>
      {file.status === "rejected" && file.rejectionReason && (
        <span className="text-destructive text-base-sm">
          {t("rejectionReason", { reason: file.rejectionReason })}
        </span>
      )}
    </li>
  );
}
