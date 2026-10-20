"use client";

import { DownloadIcon, FileTextIcon, LockIcon, UploadIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { GUARANTEE_STATE, SIGNED_CONTRACT_CONTENT_TYPE } from "@convex/guarantees/domain";
import { formatBRLCents, formatDateTimeBR } from "@mutav/i18n/brazil";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { GuaranteeStateTag } from "@mutav/ui/guarantee-state-tag";
import { Mono } from "@mutav/ui/mono";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { useStaffSignedContract } from "@/hooks/use-staff-signed-contract";

function formatFileSize(bytes: number, locale: string): string {
  const megabytes = bytes / (1024 * 1024);
  const [value, unit] = megabytes >= 1 ? [megabytes, "megabyte"] : [bytes / 1024, "kilobyte"];
  return new Intl.NumberFormat(locale, { style: "unit", unit, maximumFractionDigits: 1 }).format(
    value,
  );
}

export function GuaranteeView({
  publicId,
  preloaded,
}: {
  publicId: string;
  preloaded: Preloaded<typeof api.guarantees.signedContracts.staffGetGuarantee>;
}) {
  const guarantee = usePreloadedQuery(preloaded);
  const t = useTranslations("guarantees");

  return (
    <PageShell>
      <PageHeader
        variant="hero"
        width="narrow"
        title={t("detail.title", { id: publicId })}
        breadcrumb={
          <Eyebrow>
            <Link href="/guarantees">{t("title")}</Link>
          </Eyebrow>
        }
      />
      <PageContent variant="narrow">
        {guarantee === null ? (
          <p className="text-muted-foreground text-base-sm">{t("detail.notFound")}</p>
        ) : (
          <>
            <Card>
              <CardHeader className="border-b">
                <Eyebrow as={CardTitle} size="xs" className="font-medium">
                  {t("detail.summary")}
                </Eyebrow>
              </CardHeader>
              <CardContent className="py-4">
                <dl className="text-base-sm grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground">{t("detail.status")}</dt>
                    <dd>
                      <GuaranteeStateTag state={guarantee.status}>
                        {t(`state.${guarantee.status}`)}
                      </GuaranteeStateTag>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground">{t("detail.agency")}</dt>
                    <dd>{guarantee.agencyName ?? t("detail.notAvailable")}</dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground">{t("detail.rent")}</dt>
                    <dd>
                      <Mono>{formatBRLCents(guarantee.rentCents)}</Mono>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground">{t("detail.ceiling")}</dt>
                    <dd>
                      <Mono>{formatBRLCents(guarantee.coverageCeilingCents)}</Mono>
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <StaffSignedContractCard
              publicId={guarantee.publicId}
              isDrafted={guarantee.status === GUARANTEE_STATE.DRAFTED}
              canUpload={guarantee.viewerCanUpload}
              contract={guarantee.signedContract}
            />
          </>
        )}
      </PageContent>
    </PageShell>
  );
}

type StaffGuarantee = NonNullable<
  FunctionReturnType<typeof api.guarantees.signedContracts.staffGetGuarantee>
>;
type StaffContract = NonNullable<StaffGuarantee["signedContract"]>;

function StaffSignedContractCard({
  publicId,
  isDrafted,
  canUpload,
  contract,
}: {
  publicId: string;
  isDrafted: boolean;
  canUpload: boolean;
  contract: StaffContract | null;
}) {
  const t = useTranslations("guarantees.signedContract");
  const locale = useLocale();
  const { fileInputRef, isUploading, openFilePicker, handleFileChange } = useStaffSignedContract({
    publicId,
  });
  const showUpload = isDrafted && canUpload;

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
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
        {contract ? (
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
                    who: contract.uploadedBy.name ?? t(`uploaderKind.${contract.uploadedBy.kind}`),
                    kind: t(`uploaderKind.${contract.uploadedBy.kind}`),
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
              {showUpload ? (
                <Button variant="outline" size="sm" disabled={isUploading} onClick={openFilePicker}>
                  <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
                  {isUploading ? t("uploading") : t("replace")}
                </Button>
              ) : null}
            </div>
          </div>
        ) : showUpload ? (
          <div className="flex flex-col gap-3">
            <p className="text-muted-foreground text-base-sm">{t("help")}</p>
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={isUploading}
              onClick={openFilePicker}
            >
              <UploadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
              {isUploading ? t("uploading") : t("upload")}
            </Button>
            <p className="text-muted-foreground text-xs">{t("constraints")}</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-base-sm">{t("noneOnFile")}</p>
        )}
        {!isDrafted ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <LockIcon className="size-3.5" strokeWidth={1.25} aria-hidden />
            {t("locked")}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{t("activationByAgency")}</p>
        )}
      </CardContent>
    </Card>
  );
}
