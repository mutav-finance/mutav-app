"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import type { OnboardingWizardData } from "@/components/onboarding/onboarding-wizard";
import {
  REVIEW_FORM_DEFAULTS,
  reviewSchema,
  type ReviewFormValues,
} from "@/components/onboarding/schemas/review-schema";

type Props = {
  data: OnboardingWizardData;
  onSubmit: (values: ReviewFormValues) => void;
  onBack: () => void;
  onGoTo: (step: number) => void;
  isSubmitting: boolean;
};

export function WizardStepReview({ data, onSubmit, onBack, onGoTo, isSubmitting }: Props) {
  const t = useTranslations("onboarding.wizard.review");

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: REVIEW_FORM_DEFAULTS,
    mode: "onSubmit",
  });
  const { control, handleSubmit } = form;

  const agencyTypeLabel =
    data.agencyType === "autonomo" ? t("agencyTypeAutonomo") : t("agencyTypeEmpresa");
  const documentValue = data.agencyType === "autonomo" ? data.cpf : data.cnpj;
  const accountTypeLabel =
    data.bankAccountType === "corrente"
      ? t("accountTypeCorrente")
      : data.bankAccountType === "poupanca"
        ? t("accountTypePoupanca")
        : "—";
  // Banking step number varies by type — autonomo skips documents
  const bankingStep = data.agencyType === "empresa" ? 3 : 2;

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
          <ReviewRow label={t("nameLabel")} value={data.name} />
          <ReviewRow label={t("documentLabel")} value={<Mono>{documentValue}</Mono>} />
          <ReviewRow label={t("creciLabel")} value={data.creci} />
          <ReviewRow label={t("emailLabel")} value={data.email} />
          <ReviewRow label={t("phoneLabel")} value={<Mono>{data.phone}</Mono>} />
          {data.agencyType === "empresa" && (
            <>
              <ReviewRow label={t("representanteNameLabel")} value={data.representanteName} />
              <ReviewRow
                label={t("representanteCpfLabel")}
                value={<Mono>{data.representanteCpf}</Mono>}
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
          <ReviewRow label={t("bankLabel")} value={data.bankName} />
          <ReviewRow label={t("branchLabel")} value={<Mono>{data.bankBranch}</Mono>} />
          <ReviewRow label={t("accountLabel")} value={<Mono>{data.bankAccount}</Mono>} />
          <ReviewRow label={t("accountTypeLabel")} value={accountTypeLabel} />
          <ReviewRow
            label={t("pixKeyLabel")}
            value={data.bankPixKey ? <Mono>{data.bankPixKey}</Mono> : t("notProvided")}
            muted={!data.bankPixKey}
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
