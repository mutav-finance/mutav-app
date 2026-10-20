"use client";

import { DownloadIcon, FileTextIcon, LockIcon, UploadIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mutav/ui/alert-dialog";
import { Button } from "@mutav/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Skeleton } from "@mutav/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";
import { cn } from "@mutav/ui/cn";
import { formatDateTimeBR } from "@mutav/i18n/brazil";
import type { AgencyId } from "@convex/agencies/domain";
import { SIGNED_CONTRACT_CONTENT_TYPE, type GuaranteeState } from "@convex/guarantees/domain";
import { templateHref } from "@/lib/guarantees/templates";
import { useSignedContractCard } from "./use-signed-contract-card";

const CONTRACT_TEMPLATE_KEY = "rentalContract";

function formatFileSize(bytes: number, locale: string): string {
  const megabytes = bytes / (1024 * 1024);
  const [value, unit] = megabytes >= 1 ? [megabytes, "megabyte"] : [bytes / 1024, "kilobyte"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    maximumFractionDigits: 1,
  }).format(value);
}

export function SignedContractCard({
  agencyId,
  publicId,
  status,
}: {
  agencyId: AgencyId;
  publicId: string;
  status: GuaranteeState;
}) {
  const t = useTranslations("guaranteeDetails.signedContract");
  const locale = useLocale();
  const {
    contract,
    isLoading,
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
  } = useSignedContractCard({ agencyId, publicId, status });
  const template = templateHref(CONTRACT_TEMPLATE_KEY);

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <Eyebrow as={CardTitle} size="xs" className="font-medium">
            {t("heading")}
          </Eyebrow>
          {isDrafted ? (
            <CardAction>
              {/* A disabled button swallows pointer events; the span carries the tooltip. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(!canActivate && "cursor-not-allowed")}
                    tabIndex={canActivate ? undefined : 0}
                  >
                    <Button size="sm" disabled={!canActivate} onClick={() => setActivateOpen(true)}>
                      {t("activate")}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {canActivate ? t("activateHint") : t("activateDisabledHint")}
                </TooltipContent>
              </Tooltip>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4 py-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={`${SIGNED_CONTRACT_CONTENT_TYPE},.pdf`}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={handleFileChange}
          />

          {isLoading ? (
            <Skeleton className="h-16 w-full" aria-label={t("loading")} />
          ) : contract ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <FileTextIcon
                  className="text-muted-foreground mt-0.5 size-5 shrink-0"
                  strokeWidth={1.25}
                  aria-hidden
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="text-base-sm truncate font-medium">{contract.fileName}</span>
                  <span className="text-muted-foreground text-xs">
                    {t("uploadedBy", {
                      who:
                        contract.uploadedBy.name ?? t(`uploaderKind.${contract.uploadedBy.kind}`),
                      when: formatDateTimeBR(contract.uploadedAt),
                    })}
                    {" · "}
                    {formatFileSize(contract.sizeBytes, locale)}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {contract.downloadUrl ? (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={contract.downloadUrl} target="_blank" rel="noopener noreferrer">
                      <DownloadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                      {t("download")}
                    </a>
                  </Button>
                ) : null}
                {isDrafted ? (
                  <Button
                    variant="outline-primary"
                    size="sm"
                    disabled={isUploading}
                    onClick={openFilePicker}
                  >
                    <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                    {isUploading ? t("uploading") : t("replace")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : isDrafted ? (
            <div className="flex flex-col gap-3">
              <p className="text-muted-foreground text-base-sm">{t("help")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline-primary"
                  size="sm"
                  disabled={isUploading}
                  onClick={openFilePicker}
                >
                  <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                  {isUploading ? t("uploading") : t("upload")}
                </Button>
                {template ? (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={template} download>
                      <DownloadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                      {t("downloadTemplate")}
                    </a>
                  </Button>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">{t("constraints")}</p>
            </div>
          ) : (
            <p className="text-muted-foreground text-base-sm">{t("noneOnFile")}</p>
          )}

          {contract && !isDrafted ? (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <LockIcon className="size-3.5" strokeWidth={1.25} aria-hidden />
              {t("locked")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={activateOpen} onOpenChange={setActivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("activateDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("activateDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("activateDialog.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmActivate} disabled={isActivating}>
              {isActivating ? t("activateDialog.activating") : t("activateDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
