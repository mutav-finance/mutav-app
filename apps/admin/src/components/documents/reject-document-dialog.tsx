"use client";

import { useTranslations } from "next-intl";
import { Label } from "@mutav/ui/label";
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
import type { DocumentReviewViewModel } from "@/hooks/use-document-review";

const REJECTION_REASON_MAX_LENGTH = 1000;

export function RejectDocumentDialog({ review }: { review: DocumentReviewViewModel }) {
  const t = useTranslations("guaranteeDocuments");
  const { reject } = review;

  return (
    <AlertDialog open={reject.target !== null} onOpenChange={(open) => !open && reject.close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("reject.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("reject.description", { file: reject.target?.fileName ?? "" })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reject-document-reason">{t("reject.reasonLabel")}</Label>
          <textarea
            id="reject-document-reason"
            className="border-input bg-background text-base-sm min-h-24 rounded-md border px-3 py-2"
            maxLength={REJECTION_REASON_MAX_LENGTH}
            value={reject.reason}
            placeholder={t("reject.reasonPlaceholder")}
            onChange={(event) => reject.setReason(event.target.value)}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={review.busy}>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={review.busy || !reject.canSubmit}
            onClick={(event) => {
              event.preventDefault();
              void reject.confirm();
            }}
          >
            {t("actions.reject")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
