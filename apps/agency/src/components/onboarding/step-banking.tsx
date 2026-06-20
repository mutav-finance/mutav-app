"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@mutav/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { cn } from "@mutav/ui/cn";
import {
  BANK_ACCOUNT_TYPE,
  BANKING_FORM_DEFAULTS,
  bankingSchema,
  type BankingFormInput,
  type BankingFormValues,
} from "@/components/onboarding/schemas/banking-schema";

type Props = {
  initialValues?: Partial<BankingFormInput>;
  serverErrorCode?: string | null;
  agencyType: "" | "autonomo" | "empresa";
  onSubmit: (values: BankingFormValues) => void;
  onBack: () => void;
  isSubmitting: boolean;
};

const SERVER_ERROR_FIELD_MAP: Partial<Record<string, keyof BankingFormInput>> = {
  BANK_REQUIRED: "bankName",
  BRANCH_REQUIRED: "bankBranch",
  ACCOUNT_REQUIRED: "bankAccount",
  ACCOUNT_TYPE_REQUIRED: "bankAccountType",
};

export function StepBanking({
  initialValues,
  serverErrorCode,
  agencyType,
  onSubmit,
  onBack,
  isSubmitting,
}: Props) {
  const t = useTranslations("onboarding.banking");
  const accountTypeLabelId = React.useId();

  const form = useForm<BankingFormInput, unknown, BankingFormValues>({
    resolver: zodResolver(bankingSchema),
    defaultValues: { ...BANKING_FORM_DEFAULTS, ...initialValues },
    mode: "onSubmit",
  });

  const { control, handleSubmit, formState, setError, setValue } = form;
  const accountType = useWatch({ control, name: "bankAccountType" });
  const errors = formState.errors;

  React.useEffect(() => {
    if (!serverErrorCode) return;
    const field = SERVER_ERROR_FIELD_MAP[serverErrorCode];
    if (field) setError(field, { type: "server", message: serverErrorCode });
  }, [serverErrorCode, setError]);

  const fieldError = (key: keyof BankingFormInput): string | undefined => {
    const e = errors[key];
    if (!e?.message) return undefined;
    return t(`errors.${e.message}`);
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {agencyType === "empresa" && (
        <div className="border-accent/60 bg-accent/5 border-l-2 px-4 py-3">
          <p className="text-text-2 text-sm">{t("empresaAccountNotice")}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="bankName"
          render={({ field }) => (
            <Field
              id="field-bank"
              label={t("bankLabel")}
              error={fieldError("bankName")}
              className="sm:col-span-2"
            >
              <Input {...field} id="field-bank" placeholder={t("bankPlaceholder")} />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="bankBranch"
          render={({ field }) => (
            <Field id="field-branch" label={t("branchLabel")} error={fieldError("bankBranch")}>
              <Input
                {...field}
                id="field-branch"
                placeholder={t("branchPlaceholder")}
                inputMode="numeric"
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="bankAccount"
          render={({ field }) => (
            <Field id="field-account" label={t("accountLabel")} error={fieldError("bankAccount")}>
              <Input {...field} id="field-account" placeholder={t("accountPlaceholder")} />
            </Field>
          )}
        />

        <div className="flex flex-col gap-2 sm:col-span-2">
          <span id={accountTypeLabelId} className="text-sm font-medium">
            {t("accountTypeLabel")}
          </span>
          <ToggleGroup
            type="single"
            value={accountType || ""}
            onValueChange={(v) => {
              if (!v) return;
              setValue("bankAccountType", v as (typeof BANK_ACCOUNT_TYPE)[number], {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
            aria-labelledby={accountTypeLabelId}
            variant="outline"
            spacing={2}
            className="grid w-full grid-cols-2"
          >
            <ToggleGroupItem value="corrente">{t("accountTypeCorrente")}</ToggleGroupItem>
            <ToggleGroupItem value="poupanca">{t("accountTypePoupanca")}</ToggleGroupItem>
          </ToggleGroup>
          {fieldError("bankAccountType") && (
            <p className="text-error text-xs" role="alert">
              {fieldError("bankAccountType")}
            </p>
          )}
        </div>

        <Controller
          control={control}
          name="bankPixKey"
          render={({ field }) => (
            <Field
              id="field-pix"
              label={t("pixKeyLabel")}
              hint={t("pixKeyHint")}
              className="sm:col-span-2"
            >
              <Input {...field} id="field-pix" placeholder={t("pixKeyPlaceholder")} />
            </Field>
          )}
        />
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={onBack} disabled={isSubmitting}>
          {t("backButton")}
        </Button>
        <Button type="submit" size="lg" disabled={isSubmitting}>
          {isSubmitting ? t("savingButton") : t("nextButton")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-text-3 text-xs">{hint}</p>}
      {error && (
        <p className="text-error text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
