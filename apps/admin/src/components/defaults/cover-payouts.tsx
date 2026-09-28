"use client";

import { useTranslations } from "next-intl";
import type { Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import type { CoverPayoutRow } from "@convex/coverOperations/useCases";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { Button } from "@mutav/ui/button";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@mutav/ui/table";
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
import { useCoverPayouts, type CoverPayoutsViewModel } from "@/hooks/use-cover-payouts";

/**
 * The second half of the cover ledger: covers compliance has recorded whose
 * off-chain payout nobody has confirmed yet. Lives on the defaults screen
 * because a recorded cover leaves the queue above and lands here.
 */
export function CoverPayouts({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.coverOperations.useCases.listAwaitingPayout>;
}) {
  const t = useTranslations("defaults.payouts");
  const view = useCoverPayouts({ preloaded });

  return (
    <>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="full">
        <div className="px-4 lg:px-6">
          {view.rows.length === 0 ? (
            <p className="text-muted-foreground text-base-sm">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.operation")}</TableHead>
                    <TableHead>{t("columns.batch")}</TableHead>
                    <TableHead>{t("columns.notice")}</TableHead>
                    <TableHead>{t("columns.agency")}</TableHead>
                    <TableHead>{t("columns.guarantee")}</TableHead>
                    <TableHead>{t("columns.period")}</TableHead>
                    <TableHead className="text-right">{t("columns.amount")}</TableHead>
                    <TableHead className="text-right">{t("columns.recordedAt")}</TableHead>
                    <TableHead className="text-right">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.rows.map((row) => (
                    <PayoutRow key={row.publicId} row={row} view={view} />
                  ))}
                </TableBody>
              </Table>
              {!view.isDone && (
                <p className="text-muted-foreground text-base-sm mt-4">{t("moreAvailable")}</p>
              )}
            </div>
          )}
        </div>
      </PageContent>

      <ExecuteDialog view={view} />
    </>
  );
}

function PayoutRow({ row, view }: { row: CoverPayoutRow; view: CoverPayoutsViewModel }) {
  const t = useTranslations("defaults.payouts");
  return (
    <TableRow>
      <TableCell>
        <Mono>{row.publicId}</Mono>
      </TableCell>
      <TableCell>{row.batchId ? <Mono>{row.batchId}</Mono> : t("noBatch")}</TableCell>
      <TableCell>
        <Mono>{row.noticePublicId}</Mono>
      </TableCell>
      <TableCell>{row.agencyName}</TableCell>
      <TableCell>
        <Mono>{row.guaranteePublicId}</Mono>
      </TableCell>
      <TableCell>
        <Mono>{row.coveragePeriod}</Mono>
      </TableCell>
      <TableCell className="text-right">{formatBRLCents(row.appliedCents)}</TableCell>
      <TableCell className="text-right">{formatDateBR(row.recordedAt)}</TableCell>
      <TableCell className="text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={view.busy}
          onClick={() => view.execute.open(row)}
        >
          {t("actions.markExecuted")}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function ExecuteDialog({ view }: { view: CoverPayoutsViewModel }) {
  const t = useTranslations("defaults");
  const { target } = view.execute;

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && view.execute.close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("payouts.execute.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("payouts.execute.description")}</AlertDialogDescription>
        </AlertDialogHeader>

        {target && (
          <div className="text-base-sm flex justify-between gap-4 font-medium">
            <span>{t("payouts.execute.amount")}</span>
            <span>{formatBRLCents(target.appliedCents)}</span>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="payout-reference">{t("payouts.execute.referenceLabel")}</Label>
            <Input
              id="payout-reference"
              value={view.execute.paymentReference}
              onChange={(event) => view.execute.setPaymentReference(event.target.value)}
              placeholder={t("payouts.execute.referencePlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="payout-note">{t("payouts.execute.noteLabel")}</Label>
            <Input
              id="payout-note"
              value={view.execute.note}
              onChange={(event) => view.execute.setNote(event.target.value)}
              placeholder={t("payouts.execute.notePlaceholder")}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={!view.execute.canConfirm} onClick={view.execute.confirm}>
            {t("payouts.execute.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
