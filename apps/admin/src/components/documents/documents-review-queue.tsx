"use client";

import { DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";
import { formatDateTimeBR } from "@mutav/i18n/brazil";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Button } from "@mutav/ui/button";
import { Mono } from "@mutav/ui/mono";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { formatFileSize } from "@/components/documents/view-model";
import { RejectDocumentDialog } from "@/components/documents/reject-document-dialog";
import { useDocumentReview, type DocumentReviewViewModel } from "@/hooks/use-document-review";

type PendingDocumentRow = FunctionReturnType<
  typeof api.guarantees.staffDocuments.listDocumentsPendingReview
>["rows"][number];

/** Guarantee documents awaiting a compliance decision across every agency, oldest first. */
export function DocumentsReviewQueue({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.guarantees.staffDocuments.listDocumentsPendingReview>;
}) {
  const t = useTranslations("guaranteeDocuments");
  const queue = usePreloadedQuery(preloaded);
  const review = useDocumentReview();

  return (
    <PageShell>
      <PageHeader variant="section" title={t("queue.title")} subtitle={t("queue.subtitle")} />
      <PageContent variant="full">
        <div className="px-4 lg:px-6">
          {queue.rows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("queue.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.document")}</TableHead>
                    <TableHead>{t("columns.agency")}</TableHead>
                    <TableHead>{t("columns.guarantee")}</TableHead>
                    <TableHead>{t("columns.file")}</TableHead>
                    <TableHead>{t("columns.uploaded")}</TableHead>
                    <TableHead className="text-right">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.rows.map((row) => (
                    <QueueRow key={row.id} row={row} review={review} />
                  ))}
                </TableBody>
              </Table>
              {queue.hasMore && (
                <p className="text-muted-foreground text-base-sm mt-4">
                  {t("queue.moreAvailable")}
                </p>
              )}
            </div>
          )}
        </div>
      </PageContent>
      <RejectDocumentDialog review={review} />
    </PageShell>
  );
}

function QueueRow({ row, review }: { row: PendingDocumentRow; review: DocumentReviewViewModel }) {
  const t = useTranslations("guaranteeDocuments");
  const target = { id: row.id, fileName: row.fileName };

  return (
    <TableRow>
      <TableCell>{t(`labels.${row.key}`)}</TableCell>
      <TableCell>{row.agencyName ?? t("notAvailable")}</TableCell>
      <TableCell>
        <Mono>{row.guaranteePublicId ?? t("notAvailable")}</Mono>
      </TableCell>
      <TableCell>
        <Button
          variant="link"
          size="sm"
          className="h-auto max-w-64 p-0"
          onClick={() => review.download(row.id)}
        >
          <DownloadIcon data-icon="inline-start" strokeWidth={1.25} aria-hidden />
          <span className="truncate">{row.fileName}</span>
        </Button>
        <span className="text-muted-foreground text-base-sm block">
          {formatFileSize(row.sizeBytes)}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span>{formatDateTimeBR(row.uploadedAt)}</span>
          <span className="text-muted-foreground text-base-sm">
            {t(`uploaderKind.${row.uploadedBy.kind}`, {
              name: row.uploadedBy.name ?? t("unknownUser"),
            })}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-2">
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
      </TableCell>
    </TableRow>
  );
}
