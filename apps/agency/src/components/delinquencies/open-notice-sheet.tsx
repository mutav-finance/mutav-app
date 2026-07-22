"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { CurrencyInput } from "@mutav/ui/currency-input";
import { Field } from "@mutav/ui/field";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@mutav/ui/sheet";

type Props = {
  open: boolean;
  agencyId: AgencyId;
  onClose: () => void;
  onSuccess: (publicId: string) => void;
};

type FieldErrors = {
  contractPublicId?: string;
  rentDueDate?: string;
  amount?: string;
};

export function OpenNoticeSheet({ open, agencyId, onClose, onSuccess }: Props) {
  const t = useTranslations("delinquencies.openNoticeSheet");
  const openNotice = useMutation(api.delinquencies.mutations.openNotice);

  const [contractPublicId, setContractPublicId] = React.useState("");
  const [rentDueDate, setRentDueDate] = React.useState("");
  const [amountInput, setAmountInput] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  function handleClose() {
    setContractPublicId("");
    setRentDueDate("");
    setAmountInput("");
    setErrors({});
    onClose();
  }

  function parseAmountToCents(rawValue: string): number | null {
    // CurrencyInput yields the "R$ 1.234,56"-shaped string. Parse pt-BR
    // formatting into cents; leave as null on empty so the submit-time
    // validation surfaces the missing-field message.
    const trimmed = rawValue.trim();
    if (!trimmed) return null;
    const cleaned = trimmed
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.round(parsed * 100);
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedCents = parseAmountToCents(amountInput);
    const nextErrors: FieldErrors = {};
    if (!contractPublicId.trim()) nextErrors.contractPublicId = t("errors.MISSING_CONTRACT");
    if (!rentDueDate) nextErrors.rentDueDate = t("errors.MISSING_DATE");
    if (parsedCents == null || parsedCents <= 0) nextErrors.amount = t("errors.INVALID_AMOUNT");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (parsedCents == null) return;

    setSubmitting(true);
    try {
      const result = await openNotice({
        agencyId,
        contractPublicId: contractPublicId.trim(),
        rentDueDate,
        originalAmountCents: parsedCents,
      });
      if (result.success) {
        toast.success(t("success", { publicId: result.data.publicId }));
        onSuccess(result.data.publicId);
      } else {
        toast.error(t(`errors.${result.error.code}`));
      }
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <SheetContent side="right" className="flex flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 px-4">
          <Field label={t("fields.contractPublicId")} error={errors.contractPublicId}>
            <Input
              value={contractPublicId}
              onChange={(e) => setContractPublicId(e.target.value)}
              placeholder={t("fields.contractPublicIdPlaceholder")}
              autoFocus
            />
          </Field>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">{t("fields.rentDueDate")}</Label>
            <Input
              type="date"
              value={rentDueDate}
              onChange={(e) => setRentDueDate(e.target.value)}
            />
            {errors.rentDueDate ? (
              <p className="text-destructive text-xs">{errors.rentDueDate}</p>
            ) : null}
          </div>

          <Field label={t("fields.originalAmount")} error={errors.amount}>
            <CurrencyInput
              value={amountInput}
              onChange={setAmountInput}
              onBlur={() => {}}
              placeholder="R$ 0,00"
            />
          </Field>
        </form>

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button variant="outline" onClick={handleClose} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? t("submitting") : t("submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
