"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { SearchIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { AgencyId } from "@convex/agencies/domain";
import { brazilToday } from "@convex/delinquencies/domain";
import { dueDateFor } from "@convex/leases/domain";
import { Button } from "@mutav/ui/button";
import { CurrencyInput } from "@mutav/ui/currency-input";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Field } from "@mutav/ui/field";
import { Input } from "@mutav/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@mutav/ui/sheet";
import { formatBRLCents, formatDateBR } from "@mutav/i18n/brazil";
import { parseAmountToCents } from "@/lib/currency/parse";
import { matchesGuaranteeSearch, reportableMonths } from "@/lib/delinquencies/report-late-rent";

type Props = {
  open: boolean;
  agencyId: AgencyId;
  onClose: () => void;
  onSuccess: (publicId: string) => void;
  // Set when the sheet is opened from a guarantee's own page: the notice can
  // only be about that guarantee, so the picker step is skipped.
  fixedGuaranteePublicId?: string;
};

type ReportableGuarantee = FunctionReturnType<
  typeof api.delinquencies.useCases.listReportableGuarantees
>[number];

type FieldErrors = { month?: string; amount?: string };

function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function addressOf(row: ReportableGuarantee): string {
  return [row.streetAndNumber, row.complement].filter(Boolean).join(" · ");
}

export function OpenNoticeSheet({
  open,
  agencyId,
  onClose,
  onSuccess,
  fixedGuaranteePublicId,
}: Props) {
  const t = useTranslations("delinquencies.openNoticeSheet");
  const locale = useLocale();
  const openNotice = useMutation(api.delinquencies.mutations.openNotice);
  const rows = useQuery(
    api.delinquencies.useCases.listReportableGuarantees,
    open ? { agencyId } : "skip",
  );

  const [selectedId, setSelectedId] = React.useState<string | null>(fixedGuaranteePublicId ?? null);
  const [search, setSearch] = React.useState("");
  // Fixed at mount: the months on offer should not shift under the agency
  // while the sheet is open across midnight.
  const [today] = React.useState(() => brazilToday(Date.now()));
  // Empty / null mean "not touched yet": the latest overdue month and the
  // lease's monthly total are the defaults, derived rather than copied in.
  const [monthChoice, setMonthChoice] = React.useState("");
  const [amountChoice, setAmountChoice] = React.useState<string | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [submitting, setSubmitting] = React.useState(false);

  const selected = rows?.find((row) => row.guaranteePublicId === selectedId) ?? null;
  const months = selected
    ? reportableMonths({ today, dueDay: selected.dueDay, activatedAt: selected.activatedAt })
    : [];
  const monthLabel = (referenceMonth: string) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(`${referenceMonth}-01T00:00:00Z`),
    );
  const month = monthChoice || (months[0] ?? "");
  const amountInput = amountChoice ?? (selected ? centsToInput(selected.totalRentCents) : "");
  const dueDate =
    selected && month ? dueDateFor({ referenceMonth: month, dueDay: selected.dueDay }) : null;
  const alreadyReported = selected !== null && selected.outstandingMonths.includes(month);

  function choose(row: ReportableGuarantee) {
    setSelectedId(row.guaranteePublicId);
    setMonthChoice("");
    setAmountChoice(null);
    setErrors({});
  }

  function resetForm() {
    setSelectedId(fixedGuaranteePublicId ?? null);
    setSearch("");
    setMonthChoice("");
    setAmountChoice(null);
    setErrors({});
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function submit() {
    if (!selected) return;
    const parsedCents = parseAmountToCents(amountInput);
    const nextErrors: FieldErrors = {};
    if (!month) nextErrors.month = t("errors.MISSING_MONTH");
    if (parsedCents == null || parsedCents <= 0) nextErrors.amount = t("errors.INVALID_AMOUNT");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || parsedCents == null || alreadyReported) return;

    setSubmitting(true);
    try {
      const result = await openNotice({
        agencyId,
        guaranteePublicId: selected.guaranteePublicId,
        referenceMonth: month,
        originalAmountCents: parsedCents,
      });
      if (result.success) {
        toast.success(t("success", { month: monthLabel(month) }));
        resetForm();
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

  const eligibleMatches = (rows ?? []).filter(
    (row) => row.eligible && matchesGuaranteeSearch(row, search),
  );
  const ineligibleMatches = search.trim()
    ? (rows ?? []).filter((row) => !row.eligible && matchesGuaranteeSearch(row, search))
    : [];

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) handleClose();
      }}
    >
      <SheetContent side="right" className="flex flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{selected ? t("title") : t("pickTitle")}</SheetTitle>
          <SheetDescription>{selected ? t("description") : t("pickDescription")}</SheetDescription>
        </SheetHeader>

        {selected === null ? (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4">
            <div className="relative">
              <SearchIcon
                className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                strokeWidth={1.5}
              />
              <Input
                autoFocus
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchPlaceholder")}
              />
            </div>

            {rows === undefined ? (
              <p className="text-muted-foreground text-sm">{t("loading")}</p>
            ) : eligibleMatches.length === 0 && ineligibleMatches.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noMatches")}</p>
            ) : (
              <>
                {eligibleMatches.length > 0 ? <Eyebrow size="xs">{t("recentDue")}</Eyebrow> : null}
                <ul className="flex flex-col">
                  {eligibleMatches.map((row) => (
                    <li key={row.guaranteePublicId} className="border-b last:border-b-0">
                      <button
                        type="button"
                        onClick={() => choose(row)}
                        className="hover:bg-muted/50 flex w-full flex-col items-start gap-0.5 px-2 py-2.5 text-left"
                      >
                        <span className="text-sm font-medium">
                          {row.tenantName || t("unnamedTenant")}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {addressOf(row)} · {formatBRLCents(row.totalRentCents)} ·{" "}
                          {t("dueDay", { day: String(row.dueDay).padStart(2, "0") })}
                        </span>
                        {row.outstandingMonths.length > 0 ? (
                          <span className="text-warning text-xs">
                            {t("outstanding", {
                              months: row.outstandingMonths.map(monthLabel).join(", "),
                            })}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {ineligibleMatches.length > 0 ? (
                  <>
                    <Eyebrow size="xs">{t("outOfReach")}</Eyebrow>
                    <ul className="flex flex-col opacity-60">
                      {ineligibleMatches.map((row) => (
                        <li key={row.guaranteePublicId} className="px-2 py-2">
                          <span className="block text-sm">
                            {row.tenantName || t("unnamedTenant")}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {addressOf(row)} · {t("notInForce")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : (
          <form
            id="open-notice-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="flex flex-1 flex-col gap-4 overflow-y-auto px-4"
          >
            <div className="flex items-start justify-between gap-3 rounded border p-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">
                  {selected.tenantName || t("unnamedTenant")}
                </span>
                <span className="text-muted-foreground text-xs">{addressOf(selected)}</span>
              </div>
              {fixedGuaranteePublicId === undefined ? (
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                  {t("change")}
                </Button>
              ) : null}
            </div>

            <Field label={t("fields.month")} error={errors.month}>
              <Select value={month} onValueChange={setMonthChoice}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("fields.monthPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {months.map((referenceMonth) => (
                    <SelectItem key={referenceMonth} value={referenceMonth}>
                      {monthLabel(referenceMonth)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dueDate ? (
                <p className="text-muted-foreground text-xs">
                  {t("dueOn", { date: formatDateBR(dueDate) })}
                </p>
              ) : null}
            </Field>

            {alreadyReported ? (
              <p className="bg-muted rounded p-3 text-sm">
                {t("alreadyReported", { month: monthLabel(month) })}
              </p>
            ) : null}

            <Field label={t("fields.originalAmount")} error={errors.amount}>
              <CurrencyInput value={amountInput} onChange={setAmountChoice} />
              <p className="text-muted-foreground text-xs">{t("amountHint")}</p>
            </Field>

            <div className="bg-muted/50 flex flex-col gap-1.5 rounded p-3 text-sm">
              <Eyebrow size="xs">{t("whatHappens.heading")}</Eyebrow>
              <p>{t("whatHappens.arrears")}</p>
              <p>{t("whatHappens.review")}</p>
              <p>{t("whatHappens.cure")}</p>
            </div>
          </form>
        )}

        <SheetFooter className="flex-row justify-end gap-2 border-t">
          <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
            {t("cancel")}
          </Button>
          {selected ? (
            <Button
              type="submit"
              form="open-notice-form"
              disabled={submitting || alreadyReported || months.length === 0}
            >
              {submitting ? t("submitting") : t("submit")}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
