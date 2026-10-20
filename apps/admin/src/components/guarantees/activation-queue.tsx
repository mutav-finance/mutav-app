"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import type { ActivationQueueRow } from "@convex/guarantees/activationQueries";
import { formatBRLCents } from "@mutav/i18n/brazil";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Mono } from "@mutav/ui/mono";
import { StatusTag } from "@mutav/ui/guarantee-state-tag";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@mutav/ui/tabs";
import { useActivationQueue } from "@/hooks/use-activation-queue";
import {
  ACTIVATION_TABS,
  REVIEW_STATUS_TONE,
  SIGNED_CONTRACT_TONE,
} from "@/components/guarantees/view-model";

const BASIS_POINTS_PER_UNIT = 10_000;

type ActivationQueuePreload = Preloaded<
  typeof api.guarantees.activationQueries.listActivationQueue
>;

export function ActivationQueue({
  signed,
  awaitingSignature,
}: {
  signed: ActivationQueuePreload;
  awaitingSignature: ActivationQueuePreload;
}) {
  const t = useTranslations("staffGuarantees");
  const view = useActivationQueue({ signed, awaitingSignature });

  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="full">
        <div className="flex flex-col gap-4 px-4 lg:px-6">
          <Tabs value={view.tab} onValueChange={view.selectTab}>
            <TabsList>
              {ACTIVATION_TABS.map((tab) => (
                <TabsTrigger key={tab} value={tab}>
                  {t(`tabs.${tab}`)} ({view.counts[tab]})
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {view.rows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t(`empty.${view.tab}`)}</p>
          ) : (
            <div className="overflow-x-auto">
              <QueueTable rows={view.rows} />
              {view.hasMore && (
                <p className="text-muted-foreground text-base-sm mt-4">{t("moreAvailable")}</p>
              )}
            </div>
          )}
        </div>
      </PageContent>
    </PageShell>
  );
}

function QueueTable({ rows }: { rows: readonly ActivationQueueRow[] }) {
  const t = useTranslations("staffGuarantees");
  const format = useFormatter();
  const percent = (bps: number) =>
    format.number(bps / BASIS_POINTS_PER_UNIT, { style: "percent", maximumFractionDigits: 2 });

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.guarantee")}</TableHead>
          <TableHead>{t("columns.agency")}</TableHead>
          <TableHead>{t("columns.tenant")}</TableHead>
          <TableHead className="text-right">{t("columns.rent")}</TableHead>
          <TableHead className="text-right">{t("columns.rate")}</TableHead>
          <TableHead>{t("columns.review")}</TableHead>
          <TableHead>{t("columns.signedContract")}</TableHead>
          <TableHead className="text-right">{t("columns.actions")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.publicId}>
            <TableCell>
              <Mono>{row.publicId}</Mono>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                <span>{row.agencyName}</span>
                {!row.agencyActive && <StatusTag tone="error">{t("agencyInactive")}</StatusTag>}
              </div>
            </TableCell>
            <TableCell>{row.tenantName ?? t("notAvailable")}</TableCell>
            <TableCell className="text-right">{formatBRLCents(row.rentCents)}</TableCell>
            <TableCell className="text-right">
              <Mono>{percent(row.feeRateBps)}</Mono>
            </TableCell>
            <TableCell>
              <StatusTag tone={REVIEW_STATUS_TONE[row.review]}>
                {t(`reviewStatus.${row.review}`)}
              </StatusTag>
            </TableCell>
            <TableCell>
              <StatusTag tone={SIGNED_CONTRACT_TONE[row.signedContract]}>
                {t(`signedContract.${row.signedContract}`)}
              </StatusTag>
            </TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant={row.blockers.length === 0 ? "default" : "outline"} asChild>
                <Link href={`/guarantees/${row.publicId}`}>{t("actions.open")}</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
