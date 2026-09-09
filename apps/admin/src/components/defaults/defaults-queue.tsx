"use client";

import { useTranslations } from "next-intl";
import type { Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Button } from "@mutav/ui/button";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { GuaranteeStateTag, StatusTag } from "@mutav/ui/guarantee-state-tag";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
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
import {
  DISMISSAL_KINDS,
  useDefaultsQueue,
  type DefaultsQueueRow,
  type DefaultsQueueViewModel,
  type DismissalKind,
} from "@/hooks/use-defaults-queue";
import { daysOpen } from "@/components/defaults/view-model";

export function DefaultsQueue({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.delinquencies.useCases.listOpenAdminQueue>;
}) {
  const t = useTranslations("defaults");
  const view = useDefaultsQueue({ preloaded });

  return (
    <PageShell>
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
                    <TableHead>{t("columns.notice")}</TableHead>
                    <TableHead>{t("columns.agency")}</TableHead>
                    <TableHead>{t("columns.tenant")}</TableHead>
                    <TableHead>{t("columns.guarantee")}</TableHead>
                    <TableHead className="text-right">{t("columns.outstanding")}</TableHead>
                    <TableHead className="text-right">{t("columns.openFor")}</TableHead>
                    <TableHead className="text-right">{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.rows.map((row) => (
                    <QueueRow key={row.publicId} row={row} view={view} />
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

      <CoverDialog view={view} />
      <DismissDialog view={view} />
    </PageShell>
  );
}

function QueueRow({ row, view }: { row: DefaultsQueueRow; view: DefaultsQueueViewModel }) {
  const t = useTranslations("defaults");
  const busy = view.busyNoticeId !== null;
  const isVerified = row.status === "verified";

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Mono>{row.publicId}</Mono>
          <StatusTag tone={isVerified ? "caution" : "expiring"}>
            {t(`noticeStatus.${row.status}`)}
          </StatusTag>
        </div>
      </TableCell>
      <TableCell>{row.agencyName}</TableCell>
      <TableCell>{row.tenantName ?? t("notAvailable")}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Mono>{row.guaranteePublicId}</Mono>
          <GuaranteeStateTag state={row.guaranteeState}>
            {t(`guaranteeState.${row.guaranteeState}`)}
          </GuaranteeStateTag>
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col gap-1">
          <span>{formatBRLCents(row.updatedAmountCents)}</span>
          <span className="text-muted-foreground text-base-sm">
            {t("dueOn", { date: formatDateBR(row.rentDueDate) })}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right">
        {t("daysOpen", { days: daysOpen({ openedAt: row.openedAt, now: view.now }) })}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" disabled={busy || isVerified} onClick={() => view.verify(row)}>
            {t("actions.verify")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !isVerified}
            onClick={() => view.cover.open(row)}
          >
            {t("actions.cover")}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => view.dismiss.open(row)}
          >
            {t("actions.dismiss")}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CoverDialog({ view }: { view: DefaultsQueueViewModel }) {
  const t = useTranslations("defaults");
  const { target, preview } = view.cover;

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && view.cover.close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cover.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("cover.description")}</AlertDialogDescription>
        </AlertDialogHeader>

        {preview && (
          <div className="text-base-sm flex flex-col gap-2">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("cover.claimed")}</span>
              <span>{formatBRLCents(preview.requestedCents)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">{t("cover.remainingCapacity")}</span>
              <span>{formatBRLCents(preview.availableCents)}</span>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <span>{t("cover.applied")}</span>
              <span>{formatBRLCents(preview.appliedCents)}</span>
            </div>
            {preview.clamped && (
              <p className="text-warning-strong">
                {t("cover.clampWarning", {
                  shortfall: formatBRLCents(preview.shortfallCents),
                })}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cover-operation">{t("cover.operationLabel")}</Label>
            <Input
              id="cover-operation"
              value={view.cover.operationPublicId}
              onChange={(event) => view.cover.setOperationPublicId(event.target.value)}
              placeholder={t("cover.operationPlaceholder")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cover-note">{t("cover.noteLabel")}</Label>
            <Input
              id="cover-note"
              value={view.cover.note}
              onChange={(event) => view.cover.setNote(event.target.value)}
              placeholder={t("cover.notePlaceholder")}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={view.cover.operationPublicId.trim().length === 0}
            onClick={view.cover.confirm}
          >
            {t("cover.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DismissDialog({ view }: { view: DefaultsQueueViewModel }) {
  const t = useTranslations("defaults");

  return (
    <AlertDialog
      open={view.dismiss.target !== null}
      onOpenChange={(open) => !open && view.dismiss.close()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dismiss.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("dismiss.description")}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="dismiss-kind">{t("dismiss.reasonLabel")}</Label>
            <Select
              value={view.dismiss.kind}
              onValueChange={(value) => view.dismiss.setKind(asDismissalKind(value))}
            >
              <SelectTrigger id="dismiss-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DISMISSAL_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`dismiss.reason.${kind}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="dismiss-note">{t("dismiss.noteLabel")}</Label>
            <Input
              id="dismiss-note"
              value={view.dismiss.note}
              onChange={(event) => view.dismiss.setNote(event.target.value)}
              placeholder={t("dismiss.notePlaceholder")}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={view.dismiss.confirm}>
            {t("dismiss.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Radix hands `onValueChange` a bare `string`; the select can only ever emit
 * the values it rendered, so the miss is unreachable — it falls back to the
 * default rather than widening the mutation's argument type.
 */
function asDismissalKind(value: string): DismissalKind {
  const match = DISMISSAL_KINDS.find((kind) => kind === value);
  return match ?? "staff_dismissed";
}
