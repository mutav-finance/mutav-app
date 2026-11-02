"use client";

import { useTranslations } from "next-intl";
import type { Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import type { AnalysisQueueRow } from "@convex/guarantees/reviewQueries";
import { formatBRLCents } from "@mutav/i18n/brazil";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Mono } from "@mutav/ui/mono";
import { StatusTag } from "@mutav/ui/guarantee-state-tag";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { useUnderwritingQueue } from "@/hooks/use-underwriting-queue";
import { daysWaiting } from "@/components/underwriting/view-model";

export function UnderwritingQueue({
  queue,
  awaitingDispatch,
}: {
  queue: Preloaded<typeof api.guarantees.reviewQueries.listAnalysisQueue>;
  awaitingDispatch: Preloaded<typeof api.guarantees.reviewQueries.listAwaitingDispatch>;
}) {
  const t = useTranslations("underwriting");
  const view = useUnderwritingQueue({ queue, awaitingDispatch });

  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="full">
        <section className="flex flex-col gap-3 px-4 lg:px-6">
          <h2 className="text-base font-semibold">{t("queue.heading")}</h2>
          {view.rows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("queue.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <QueueTable rows={view.rows} now={view.now} />
              {!view.isDone && (
                <p className="text-muted-foreground text-base-sm mt-4">
                  {t("queue.moreAvailable")}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="mt-8 flex flex-col gap-3 px-4 lg:px-6">
          <h2 className="text-base font-semibold">{t("dispatch.heading")}</h2>
          <p className="text-muted-foreground text-base-sm">{t("dispatch.subtitle")}</p>
          {view.dispatchRows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("dispatch.empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <QueueTable rows={view.dispatchRows} now={view.now} />
            </div>
          )}
        </section>
      </PageContent>
    </PageShell>
  );
}

function QueueTable({ rows, now }: { rows: readonly AnalysisQueueRow[]; now: number }) {
  const t = useTranslations("underwriting");
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.guarantee")}</TableHead>
          <TableHead>{t("columns.agency")}</TableHead>
          <TableHead>{t("columns.tenant")}</TableHead>
          <TableHead className="text-right">{t("columns.rent")}</TableHead>
          <TableHead>{t("columns.score")}</TableHead>
          <TableHead>{t("columns.bureau")}</TableHead>
          <TableHead className="text-right">{t("columns.waiting")}</TableHead>
          <TableHead className="text-right">{t("columns.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.publicId}>
            <TableCell>
              <Mono>{row.publicId}</Mono>
            </TableCell>
            <TableCell>{row.agencyName}</TableCell>
            <TableCell>{row.tenantName ?? t("notAvailable")}</TableCell>
            <TableCell className="text-right">{formatBRLCents(row.rentCents)}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Mono>{row.score}</Mono>
                <StatusTag tone={row.tier === "negado" ? "caution" : "neutral"}>
                  {t(`tier.${row.tier}`)}
                </StatusTag>
              </div>
            </TableCell>
            <TableCell>
              {row.bureauProvider === null ? (
                <span className="text-muted-foreground">{t("notAvailable")}</span>
              ) : (
                <div className="flex items-center gap-2">
                  <span>{row.bureauProvider}</span>
                  {row.isMockScore && <StatusTag tone="expiring">{t("mockScore")}</StatusTag>}
                </div>
              )}
            </TableCell>
            <TableCell className="text-right">
              {row.requestedAt === null
                ? t("notAvailable")
                : t("daysWaiting", { days: daysWaiting({ requestedAt: row.requestedAt, now }) })}
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="outline" asChild>
                <Link href={`/underwriting/${row.publicId}`}>{t("actions.open")}</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
