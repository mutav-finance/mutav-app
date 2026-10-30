"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { CheckIcon, XIcon, UploadIcon } from "lucide-react";
import type { ClaimEvidenceKind } from "@convex/delinquencies/domain";
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
import { Checkbox } from "@mutav/ui/checkbox";
import { ClaimStatusTag } from "@mutav/ui/claim-status-tag";
import { CurrencyInput } from "@mutav/ui/currency-input";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Field } from "@mutav/ui/field";
import { Input } from "@mutav/ui/input";
import { Mono } from "@mutav/ui/mono";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import {
  formatBRLCents,
  formatDateBR,
  formatDateTimeBR,
  formatMonthYear,
} from "@mutav/i18n/brazil";
import { Link } from "@mutav/i18n/navigation";
import { CASE_STEPS } from "@/lib/claims/case-view";
import { CompactStepIndicator } from "@/components/claims/compact-step-indicator";
import {
  useClaimCasePanel,
  type ClaimEvidenceFile,
  type ClaimRequest,
} from "@/components/claims/use-claim-case-panel";

const WITHDRAW_REASONS = ["agency_withdrew", "duplicate", "data_error"] as const;
type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

function isWithdrawReason(value: string): value is WithdrawReason {
  return WITHDRAW_REASONS.some((reason) => reason === value);
}

/**
 * One late-rent case in every state it can be in. The layout never moves —
 * header, stepper, "what now", evidence, money, history — only what each slot
 * says changes, so the agency always looks in the same place. Rendered inside
 * a sheet from the claims queue and from the guarantee page.
 */
export function ClaimCasePanel({
  publicId,
  onClosed,
}: {
  publicId: string;
  onClosed?: () => void;
}) {
  const t = useTranslations("claims.panel");
  const tStatus = useTranslations("delinquencies.caseStatus");
  const locale = useLocale();
  const view = useClaimCasePanel({ publicId, onClosed });

  if (view.kind === "loading") {
    return <p className="text-muted-foreground text-sm">{t("loading")}</p>;
  }
  if (view.kind === "missing") {
    return <p className="text-muted-foreground text-sm">{t("notFound")}</p>;
  }

  const { detail } = view;
  const month = formatMonthYear(detail.rentDueDate, locale, { month: "long" });
  const address = [detail.streetAndNumber, detail.complement].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <Eyebrow size="xs">{t("eyebrow", { month })}</Eyebrow>
          <ClaimStatusTag status={view.status}>{tStatus(view.status)}</ClaimStatusTag>
        </div>
        <p className="text-base font-semibold">
          {detail.tenantName || t("unnamedTenant")} · {formatBRLCents(detail.originalAmountCents)}
        </p>
        <Link
          href={`/guarantees/${detail.guaranteePublicId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          {address}
        </Link>
      </header>

      {view.step !== null ? (
        <CompactStepIndicator
          current={view.step}
          labels={CASE_STEPS.map((step) => t(`steps.${step}`))}
          progressLabel={t("progress")}
          doneSuffix={t("stepDone")}
          currentSuffix={t("stepCurrent")}
        />
      ) : null}

      <WhatNow view={view} month={month} />

      {view.pendingSignedContract !== null && view.canEditEvidence ? (
        <div className="border-warning-strong bg-warning-dim rounded border p-3 text-sm">
          <p className="font-medium">{t("precondition.title")}</p>
          <p className="text-muted-foreground">
            {t(`precondition.signedContract.${view.pendingSignedContract}`)}
          </p>
          <Link href={`/guarantees/${detail.guaranteePublicId}`} className="text-sm underline">
            {t("precondition.openDocuments")}
          </Link>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <Eyebrow size="xs">{t("evidence.heading")}</Eyebrow>
        <ul className="flex flex-col divide-y rounded border">
          {view.evidenceKinds.map((kind) => (
            <EvidenceSlot
              key={kind}
              kind={kind}
              file={view.latest.get(kind)}
              request={view.openRequests.get(kind)}
              editable={view.canEditEvidence}
              uploading={view.uploadingKind === kind}
              onUpload={(file) => view.upload(kind, file)}
              onDownload={view.download}
            />
          ))}
        </ul>
      </section>

      {view.status === "ready_to_claim" ? (
        <section className="flex flex-col gap-3">
          <Field label={t("amount.label")}>
            <CurrencyInput value={view.amountInput} onChange={view.setAmountInput} />
            <p className="text-muted-foreground text-xs">{t("amount.hint")}</p>
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={view.declared}
              onCheckedChange={(checked) => view.setDeclared(checked === true)}
              className="mt-0.5"
            />
            <span>{t("declaration")}</span>
          </label>
          <Button disabled={!view.canSubmit || view.busy} onClick={() => void view.submit()}>
            {t("submit")}
          </Button>
          {view.missing.length > 0 ? (
            <p className="text-muted-foreground text-center text-xs">
              {t("missing", {
                items: view.missing.map((item) => t(`requirement.${item}`)).join(" · "),
              })}
            </p>
          ) : null}
        </section>
      ) : null}

      {view.status === "info_requested" ? (
        <Button disabled={!view.canResubmit || view.busy} onClick={() => void view.resubmit()}>
          {t("resubmit")}
        </Button>
      ) : null}

      {detail.claim || detail.cover ? (
        <section className="grid grid-cols-3 gap-3 text-sm">
          <Money label={t("money.requested")} cents={detail.claim?.claimedAmountCents ?? null} />
          <Money label={t("money.approved")} cents={detail.cover?.appliedCents ?? null} />
          <Money
            label={
              detail.cover?.executedAt
                ? t("money.paidOn", { date: formatDateBR(detail.cover.executedAt) })
                : t("money.paid")
            }
            cents={detail.cover?.executedAt ? detail.cover.appliedCents : null}
          />
        </section>
      ) : null}

      {detail.cover?.paymentReference ? (
        <p className="text-muted-foreground text-xs">
          {t("money.reference")}: <Mono>{detail.cover.paymentReference}</Mono>
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <Eyebrow size="xs">{t("history.heading")}</Eyebrow>
        <ol className="flex flex-col gap-2 border-l pl-4">
          {view.events.map((event) => (
            <li key={`${event.key}-${event.at}`} className="text-sm">
              {t(`history.${event.key}`)}
              <Mono className="text-muted-foreground block text-xs">
                {formatDateTimeBR(event.at)}
              </Mono>
            </li>
          ))}
        </ol>
      </section>

      {detail.canAct ? <AgencyExits view={view} /> : null}

      <p className="text-muted-foreground text-xs">
        {t("code")}: <Mono>{detail.publicId}</Mono>
      </p>
    </div>
  );
}

type PanelView = Extract<ReturnType<typeof useClaimCasePanel>, { kind: "ready" }>;

function WhatNow({ view, month }: { view: PanelView; month: string }) {
  const t = useTranslations("claims.panel.whatNow");
  const { detail } = view;
  switch (view.status) {
    case "reported":
      return <Note>{t("reported", { date: formatDateBR(detail.claimableFrom) })}</Note>;
    case "ready_to_claim":
      return <Note>{t("readyToClaim")}</Note>;
    case "under_review":
      return <Note>{detail.verifiedAt ? t("verified") : t("underReview")}</Note>;
    case "info_requested":
      return (
        <div className="border-warning-strong rounded border border-l-4 p-3 text-sm">
          <p className="font-medium">{t("infoRequested")}</p>
          {[...view.openRequests.values()].map((request) => (
            <p key={request.id} className="text-muted-foreground">
              {t("requestLine", {
                item: t(`kind.${request.evidenceKind}`),
                reason: request.reason,
                date: formatDateBR(request.dueAt),
              })}
            </p>
          ))}
        </div>
      );
    case "approved":
      return <Note>{t("approved")}</Note>;
    case "paid":
      return <Note tone="positive">{t("paid", { month })}</Note>;
    default:
      return <Note>{t(`ended.${view.status}`)}</Note>;
  }
}

function Note({ children, tone }: { children: React.ReactNode; tone?: "positive" }) {
  return (
    <p
      className={
        tone === "positive"
          ? "border-success rounded border border-l-4 p-3 text-sm"
          : "bg-muted/50 rounded p-3 text-sm"
      }
    >
      {children}
    </p>
  );
}

function Money({ label, cents }: { label: string; cents: number | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      {cents === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <Mono className="font-semibold">{formatBRLCents(cents)}</Mono>
      )}
    </div>
  );
}

function EvidenceSlot({
  kind,
  file,
  request,
  editable,
  uploading,
  onUpload,
  onDownload,
}: {
  kind: ClaimEvidenceKind;
  file: ClaimEvidenceFile | undefined;
  request: ClaimRequest | undefined;
  editable: boolean;
  uploading: boolean;
  onUpload: (file: File) => void;
  onDownload: (id: ClaimEvidenceFile["id"]) => void;
}) {
  const t = useTranslations("claims.panel.evidence");
  const input = React.useRef<HTMLInputElement | null>(null);
  const rejected = file?.status === "rejected";
  const done = file !== undefined && !rejected;

  return (
    <li className="flex items-start gap-3 p-3">
      <span
        aria-hidden
        className={
          done
            ? "bg-success text-background mt-0.5 flex size-5 items-center justify-center"
            : rejected
              ? "bg-destructive text-background mt-0.5 flex size-5 items-center justify-center"
              : "mt-0.5 size-5 border"
        }
      >
        {done ? (
          <CheckIcon className="size-3.5" />
        ) : rejected ? (
          <XIcon className="size-3.5" />
        ) : null}
      </span>
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{t(`kind.${kind}`)}</span>
        <span className="text-muted-foreground text-xs">
          {file ? (
            <button type="button" className="underline" onClick={() => onDownload(file.id)}>
              {file.fileName}
            </button>
          ) : (
            t(`hint.${kind}`)
          )}
          {file ? ` · ${t(`status.${file.status}`)}` : null}
        </span>
        {rejected && file.rejectionReason ? (
          <span className="text-destructive text-xs">“{file.rejectionReason}”</span>
        ) : null}
        {request && !rejected ? (
          <span className="text-warning text-xs">{request.reason}</span>
        ) : null}
      </div>
      {editable ? (
        <>
          <input
            ref={input}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            aria-label={t(`kind.${kind}`)}
            onChange={(event) => {
              const chosen = event.target.files?.[0];
              event.target.value = "";
              if (chosen) onUpload(chosen);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant={done ? "ghost" : "outline"}
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            <UploadIcon className="size-3.5" />
            {uploading ? t("uploading") : done ? t("replace") : t("upload")}
          </Button>
        </>
      ) : null}
    </li>
  );
}

function AgencyExits({ view }: { view: PanelView }) {
  const t = useTranslations("claims.panel.exits");
  const tReason = useTranslations("delinquencies.detailSheet.cancellation.reason");
  const [dialog, setDialog] = React.useState<"cure" | "withdraw" | null>(null);
  const [note, setNote] = React.useState("");
  const [reason, setReason] = React.useState<WithdrawReason>("agency_withdrew");

  return (
    <div className="flex flex-wrap justify-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setDialog("cure")}>
        {t("cure")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setDialog("withdraw")}>
        {t("withdraw")}
      </Button>

      <AlertDialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog === "cure" ? t("cureTitle") : t("withdrawTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "cure" ? t("cureDescription") : t("withdrawDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog === "cure" ? (
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("curePlaceholder")}
              aria-label={t("curePlaceholder")}
            />
          ) : (
            <Select
              value={reason}
              onValueChange={(value) => isWithdrawReason(value) && setReason(value)}
            >
              <SelectTrigger aria-label={t("reason")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WITHDRAW_REASONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {tReason(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={view.busy}>{t("back")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={view.busy}
              onClick={() => (dialog === "cure" ? view.markCured(note) : view.withdraw(reason))}
            >
              {dialog === "cure" ? t("cureConfirm") : t("withdrawConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
