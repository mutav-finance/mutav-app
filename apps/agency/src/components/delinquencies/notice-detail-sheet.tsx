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
import { DelinquencyStatusTag } from "@/components/delinquencies/delinquency-status-tag";
import { formatBRLCents, formatDateBR, formatDateTimeBR } from "@/lib/contracts/format";

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
  const tStatus = useTranslations("delinquencies.status");
  const open = publicId != null;

  const detail = useQuery(
    api.delinquencies.useCases.getByPublicId,
    publicId ? { publicId } : "skip",
  );
  const markCanceled = useMutation(api.delinquencies.mutations.markCanceled);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [reason, setReason] = React.useState<CancelReason>("agency_withdrew");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  function handleClose() {
    setCancelOpen(false);
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
                      <DelinquencyStatusTag status={detail.status}>
                        {tStatus(detail.status)}
                      </DelinquencyStatusTag>
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
                    <dt className="text-muted-foreground w-32">{t("fields.updatedAmount")}</dt>
                    <dd>
                      <Mono>{formatBRLCents(detail.updatedAmountCents)}</Mono>
                    </dd>
                  </div>
                  <div className="flex items-center gap-3">
                    <dt className="text-muted-foreground w-32">{t("fields.evidenceSource")}</dt>
                    <dd className="text-muted-foreground">
                      {t(`evidenceSource.${detail.evidenceSource}`)}
                    </dd>
                  </div>
                </dl>

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
            {detail && detail.status === "open" ? (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                {t("cancel.trigger")}
              </Button>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
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
    </>
  );
}
