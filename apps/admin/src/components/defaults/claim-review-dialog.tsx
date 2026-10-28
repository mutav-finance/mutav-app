"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useConvex, useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CLAIM_EVIDENCE_KINDS, type ClaimEvidenceKind } from "@convex/delinquencies/domain";
import type { DelinquencyAdminQueueRow } from "@convex/delinquencies/useCases";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { Button } from "@mutav/ui/button";
import { Checkbox } from "@mutav/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@mutav/ui/alert-dialog";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { Mono } from "@mutav/ui/mono";
import { isVerifiable } from "@/hooks/use-defaults-queue";

type Requested = Partial<Record<ClaimEvidenceKind, string>>;

/**
 * Staff's view of one filed claim: the files the agency attached, the
 * "Pedir informação" form that sends chosen files back with a reason and a
 * deadline, and the confirm action the queue row also offers. Mounted only
 * while a row is under review; the caller keys it by notice so the form
 * starts empty for each one.
 */
export function ClaimReviewDialog({
  row,
  busy: queueBusy,
  onClose,
  onVerify,
}: {
  row: DelinquencyAdminQueueRow;
  busy: boolean;
  onClose: () => void;
  onVerify: (row: DelinquencyAdminQueueRow) => Promise<void>;
}) {
  const t = useTranslations("defaults.claimReview");
  const convex = useConvex();
  const requestInfo = useMutation(api.delinquencies.claims.staffRequestClaimInfo);
  const [requested, setRequested] = React.useState<Requested>({});
  const [dueAt, setDueAt] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const canRequest = isVerifiable(row);
  const locked = busy || queueBusy;
  const live = row.evidence.filter((file) => file.status !== "superseded");
  const chosen = CLAIM_EVIDENCE_KINDS.filter((kind) => requested[kind] !== undefined);
  const ready =
    chosen.length > 0 && chosen.every((kind) => (requested[kind] ?? "").trim()) && dueAt !== "";

  async function openFile(evidenceId: Id<"claimEvidence">) {
    const url = await convex.query(api.delinquencies.claimEvidence.staffGetClaimEvidenceUrl, {
      evidenceId,
    });
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    else toast.error(t("fileMissing"));
  }

  async function send() {
    setBusy(true);
    try {
      const result = await requestInfo({
        noticePublicId: row.publicId,
        requests: chosen.map((kind) => ({ evidenceKind: kind, reason: requested[kind] ?? "" })),
        dueAt,
      });
      if (result.success) {
        toast.success(t("sent"));
        onClose();
      } else {
        toast.error(t(`errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("errors.unexpected"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title", { notice: row.publicId })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("summary", {
              tenant: row.tenantName ?? "—",
              amount: formatBRLCents(row.claimedAmountCents ?? row.originalAmountCents),
              due: formatDateBR(row.rentDueDate),
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul className="flex flex-col divide-y rounded border">
          {CLAIM_EVIDENCE_KINDS.map((kind) => {
            const file = live
              .filter((candidate) => candidate.kind === kind)
              .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt))[0];
            const asking = requested[kind] !== undefined;
            return (
              <li key={kind} className="flex flex-col gap-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{t(`kind.${kind}`)}</span>
                    {file ? (
                      <button
                        type="button"
                        className="text-muted-foreground text-left text-xs underline"
                        onClick={() => void openFile(file.id)}
                      >
                        {file.fileName} · {t(`status.${file.status}`)}
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-xs">{t("noFile")}</span>
                    )}
                  </div>
                  {canRequest ? (
                    <Label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={asking}
                        onCheckedChange={(checked) =>
                          setRequested((current) => {
                            const next = { ...current };
                            if (checked === true) next[kind] = "";
                            else delete next[kind];
                            return next;
                          })
                        }
                      />
                      {t("askAgain")}
                    </Label>
                  ) : null}
                </div>
                {asking ? (
                  <Input
                    value={requested[kind] ?? ""}
                    onChange={(event) =>
                      setRequested((current) => ({ ...current, [kind]: event.target.value }))
                    }
                    placeholder={t("reasonPlaceholder")}
                    aria-label={t("reasonFor", { item: t(`kind.${kind}`) })}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>

        {canRequest && chosen.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs" htmlFor={`due-${row.publicId}`}>
              {t("dueAt")}
            </Label>
            <Input
              id={`due-${row.publicId}`}
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
        ) : null}

        {!canRequest ? <p className="text-muted-foreground text-xs">{t("locked")}</p> : null}

        <AlertDialogFooter>
          <Mono className="text-muted-foreground mr-auto text-xs">{row.publicId}</Mono>
          <Button variant="outline" onClick={onClose} disabled={locked}>
            {t("close")}
          </Button>
          {canRequest ? (
            <>
              <Button variant="outline" onClick={() => void send()} disabled={!ready || locked}>
                {t("send")}
              </Button>
              <Button onClick={() => void onVerify(row)} disabled={locked}>
                {t("verify")}
              </Button>
            </>
          ) : null}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
