"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
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
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@mutav/ui/sheet";
import { ClaimStatusTag } from "@mutav/ui/claim-status-tag";
import { formatBRLCents, formatDateBR, formatDateTimeBR } from "@mutav/i18n/brazil";

type Props = {
  publicId: string | null;
  onClose: () => void;
};

const CANCEL_REASONS = ["agency_withdrew", "duplicate", "data_error"] as const;
type CancelReason = (typeof CANCEL_REASONS)[number];

function isCancelReason(v: string): v is CancelReason {
  return CANCEL_REASONS.some((r) => r === v);
}

export function NoticeDetailSheet({ publicId, onClose }: Props) {
  const t = useTranslations("delinquencies.detailSheet");
  const tCaseStatus = useTranslations("delinquencies.caseStatus");
  const tEvidence = useTranslations("delinquencies.evidenceSource");
  const open = publicId != null;

  const detail = useQuery(
    api.delinquencies.useCases.getByPublicId,
    publicId ? { publicId } : "skip",
  );
  const markCanceled = useMutation(api.delinquencies.mutations.markCanceled);
  const markResolved = useMutation(api.delinquencies.mutations.markResolved);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cureOpen, setCureOpen] = React.useState(false);
  const [cureNote, setCureNote] = React.useState("");
  const [reason, setReason] = React.useState<CancelReason>("agency_withdrew");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function handleClose() {
    setCancelOpen(false);
    setCureOpen(false);
    setCureNote("");
    setReason("agency_withdrew");
    setNote("");
    onClose();
  }

  async function handleConfirmCancel() {
    if (!detail) return;
    setSubmitting(true);
    try {
      const result = await markCanceled({
        noticePublicId: detail.publicId,
        cancellation: {
          reason,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      if (result.success) {
        toast.success(t("cancel.success"));
        handleClose();
      } else {
        toast.error(t(`cancel.errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("cancel.errors.UNEXPECTED"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCure() {
    if (!detail) return;
    setSubmitting(true);
    try {
      const result = await markResolved({
        noticePublicId: detail.publicId,
        resolution: {
          kind: "tenant_cured",
          ...(cureNote.trim() ? { note: cureNote.trim() } : {}),
        },
      });
      if (result.success) {
        toast.success(t("cure.success"));
        handleClose();
      } else {
        toast.error(t(`cure.errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("cure.errors.UNEXPECTED"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(v) => {
          if (!v) handleClose();
        }}
      >
        <SheetContent side="right" className="flex flex-col sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>
              <Mono>{publicId ?? ""}</Mono>
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            {publicId == null ? null : detail === undefined ? (
              <p className="text-muted-foreground text-sm">{t("loading")}</p>
            ) : detail === null ? (
              <p className="text-muted-foreground text-sm">{t("notFound")}</p>
            ) : (
              <>
                <dl className="grid gap-3 text-sm">
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground w-32">{t("fields.status")}</dt>
                    <dd>
                      <ClaimStatusTag status={detail.caseStatus}>
                        {tCaseStatus(detail.caseStatus)}
                      </ClaimStatusTag>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground w-32">{t("fields.rentDueDate")}</dt>
                    <dd>
                      <Mono>{formatDateBR(detail.rentDueDate)}</Mono>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground w-32">{t("fields.openedAt")}</dt>
                    <dd>
                      <Mono>{formatDateTimeBR(detail.openedAt)}</Mono>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground w-32">{t("fields.originalAmount")}</dt>
                    <dd>
                      <Mono className="font-semibold">
                        {formatBRLCents(detail.originalAmountCents)}
                      </Mono>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground w-32">{t("fields.evidenceSource")}</dt>
                    <dd className="text-muted-foreground">{tEvidence(detail.evidenceSource)}</dd>
                  </div>
                </dl>

                {detail.cover ? (
                  <div className="border-border flex flex-col gap-2 rounded border p-3">
                    <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      {t("cover.heading")}
                    </p>
                    <dl className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground text-xs">{t("cover.requested")}</dt>
                        <dd>
                          <Mono>{formatBRLCents(detail.cover.requestedCents)}</Mono>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">{t("cover.approved")}</dt>
                        <dd>
                          <Mono>{formatBRLCents(detail.cover.appliedCents)}</Mono>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground text-xs">
                          {detail.cover.executedAt
                            ? t("cover.paidAt", { date: formatDateBR(detail.cover.executedAt) })
                            : t("cover.paid")}
                        </dt>
                        <dd>
                          {detail.cover.executedAt ? (
                            <Mono>{formatBRLCents(detail.cover.appliedCents)}</Mono>
                          ) : (
                            <span className="text-muted-foreground">{t("cover.pending")}</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                    {detail.cover.paymentReference ? (
                      <p className="text-muted-foreground text-xs">
                        {t("cover.reference")}: <Mono>{detail.cover.paymentReference}</Mono>
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {detail.resolution ? (
                  <div className="border-border flex flex-col gap-2 rounded border p-3">
                    <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      {t("resolution.heading")}
                    </p>
                    <p className="text-sm">{t(`resolution.kind.${detail.resolution.kind}`)}</p>
                    <Mono className="text-muted-foreground text-xs">
                      {formatDateTimeBR(detail.resolution.resolvedAt)}
                    </Mono>
                    {detail.resolution.note ? (
                      <p className="text-sm">{detail.resolution.note}</p>
                    ) : null}
                  </div>
                ) : null}

                {detail.cancellation ? (
                  <div className="border-border flex flex-col gap-2 rounded border p-3">
                    <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                      {t("cancellation.heading")}
                    </p>
                    <p className="text-sm">
                      {t(`cancellation.reason.${detail.cancellation.reason}`)}
                    </p>
                    <Mono className="text-muted-foreground text-xs">
                      {formatDateTimeBR(detail.cancellation.canceledAt)}
                    </Mono>
                    {detail.cancellation.note ? (
                      <p className="text-sm">{detail.cancellation.note}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <SheetFooter className="flex-row justify-between gap-2 border-t">
            <Button variant="outline" onClick={handleClose}>
              {t("close")}
            </Button>
            {detail?.canAct ? (
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setCancelOpen(true)}>
                  {t("cancel.trigger")}
                </Button>
                <Button onClick={() => setCureOpen(true)}>{t("cure.trigger")}</Button>
              </div>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={cancelOpen}
        onOpenChange={(v) => {
          setCancelOpen(v);
          if (!v) {
            setReason("agency_withdrew");
            setNote("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cancel.dialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cancel.dialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("cancel.reasonLabel")}</Label>
              <Select
                value={reason}
                onValueChange={(v) => {
                  if (isCancelReason(v)) setReason(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CANCEL_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {t(`cancellation.reason.${r}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">{t("cancel.noteLabel")}</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("cancel.notePlaceholder")}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{t("cancel.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCancel} disabled={submitting}>
              {submitting ? t("cancel.submitting") : t("cancel.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={cureOpen}
        onOpenChange={(v) => {
          setCureOpen(v);
          if (!v) setCureNote("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cure.dialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cure.dialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("cure.noteLabel")}</Label>
            <Input
              value={cureNote}
              onChange={(e) => setCureNote(e.target.value)}
              placeholder={t("cure.notePlaceholder")}
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>{t("cure.back")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCure} disabled={submitting}>
              {submitting ? t("cure.submitting") : t("cure.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
