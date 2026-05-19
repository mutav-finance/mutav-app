"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import type { OnboardingWizardSnapshot } from "@/components/onboarding/use-onboarding-wizard";
import {
  REVIEW_FORM_DEFAULTS,
  reviewSchema,
  type ReviewFormValues,
} from "@/components/onboarding/schemas/review-schema";

// Review reads the accumulated snapshot rather than receiving form-style
// `initialValues`. Display-only access across prior steps; never writes.
// Diverges from the step1/banking prop shape on purpose.
type Props = {
  snapshot: OnboardingWizardSnapshot;
  onSubmit: (values: ReviewFormValues) => void;
  onBack: () => void;
  onGoTo: (step: number) => void;
  isSubmitting: boolean;
};

export function WizardStepReview({ snapshot, onSubmit, onBack, onGoTo, isSubmitting }: Props) {
  const t = useTranslations("onboarding.wizard.review");

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: REVIEW_FORM_DEFAULTS,
    mode: "onSubmit",
  });
  const { control, handleSubmit } = form;

  const agencyTypeLabel =
    snapshot.agencyType === "autonomo" ? t("agencyTypeAutonomo") : t("agencyTypeEmpresa");
  const documentValue = snapshot.agencyType === "autonomo" ? snapshot.cpf : snapshot.cnpj;
  const accountTypeLabel =
    snapshot.bankAccountType === "corrente"
      ? t("accountTypeCorrente")
      : snapshot.bankAccountType === "poupanca"
        ? t("accountTypePoupanca")
        : "—";
  // Banking step number varies by type — autonomo skips documents
  const bankingStep = snapshot.agencyType === "empresa" ? 3 : 2;

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      <section aria-labelledby="review-profile-heading">
        <div className="mb-3 flex items-center justify-between">
          <h3
            id="review-profile-heading"
            className="text-text-3 font-mono text-xs tracking-wide uppercase"
          >
            {t("profileSection")}
          </h3>
          <button
            type="button"
            onClick={() => onGoTo(1)}
            disabled={isSubmitting}
            className="text-accent font-mono text-xs hover:opacity-80 disabled:opacity-40"
          >
            {t("editButton")}
          </button>
        </div>
        <div className="border-border divide-border divide-y border">
          <ReviewRow label={t("agencyTypeLabel")} value={agencyTypeLabel} />
          <ReviewRow label={t("nameLabel")} value={snapshot.name} />
          <ReviewRow label={t("documentLabel")} value={<Mono>{documentValue}</Mono>} />
          <ReviewRow label={t("creciLabel")} value={snapshot.creci} />
          <ReviewRow label={t("emailLabel")} value={snapshot.email} />
          <ReviewRow label={t("phoneLabel")} value={<Mono>{snapshot.phone}</Mono>} />
          {snapshot.agencyType === "empresa" && (
            <>
              <ReviewRow label={t("representanteNameLabel")} value={snapshot.representanteName} />
              <ReviewRow
                label={t("representanteCpfLabel")}
                value={<Mono>{snapshot.representanteCpf}</Mono>}
              />
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="review-banking-heading">
        <div className="mb-3 flex items-center justify-between">
          <h3
            id="review-banking-heading"
            className="text-text-3 font-mono text-xs tracking-wide uppercase"
          >
            {t("bankingSection")}
          </h3>
          <button
            type="button"
            onClick={() => onGoTo(bankingStep)}
            disabled={isSubmitting}
            className="text-accent font-mono text-xs hover:opacity-80 disabled:opacity-40"
          >
            {t("editButton")}
          </button>
        </div>
        <div className="border-border divide-border divide-y border">
          <ReviewRow label={t("bankLabel")} value={snapshot.bankName} />
          <ReviewRow label={t("branchLabel")} value={<Mono>{snapshot.bankBranch}</Mono>} />
          <ReviewRow label={t("accountLabel")} value={<Mono>{snapshot.bankAccount}</Mono>} />
          <ReviewRow label={t("accountTypeLabel")} value={accountTypeLabel} />
          <ReviewRow
            label={t("pixKeyLabel")}
            value={snapshot.bankPixKey ? <Mono>{snapshot.bankPixKey}</Mono> : t("notProvided")}
            muted={!snapshot.bankPixKey}
          />
        </div>
      </section>

      <div className="border-border flex flex-col gap-3 border-t pt-4">
        <Controller
          control={control}
          name="consentMarketing"
          render={({ field }) => (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                ref={field.ref}
                name={field.name}
                disabled={isSubmitting}
                className="accent-accent mt-0.5 shrink-0"
              />
              <span className="text-text-2 text-sm">{t("consentMarketing")}</span>
            </label>
          )}
        />
        <p className="text-text-2 text-sm">
          {t.rich("consentLegal", {
            privacy: (chunks) => (
              <Link href="/privacidade" className="text-accent hover:opacity-80">
                {chunks}
              </Link>
            ),
            terms: (chunks) => (
              <Link href="/termos" className="text-accent hover:opacity-80">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          {t("backButton")}
        </Button>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("submittingButton") : t("submitButton")}
        </Button>
      </div>
    </form>
  );
}

function ReviewRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-text-3 shrink-0 text-sm">{label}</span>
      <span
        className={
          muted
            ? "text-text-3 min-w-0 truncate text-right text-sm"
            : "text-text min-w-0 truncate text-right text-sm font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}
