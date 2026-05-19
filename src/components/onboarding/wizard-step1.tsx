"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { maskCPF, maskCNPJ, maskPhone } from "@/lib/brazil";
import {
  PROFILE_FORM_DEFAULTS,
  profileSchema,
  type ProfileFormValues,
} from "@/components/onboarding/schemas/profile-schema";

type Props = {
  initialValues?: Partial<ProfileFormValues>;
  serverErrorCode?: string | null;
  onSubmit: (values: ProfileFormValues) => void;
  isSubmitting: boolean;
};

// Server error codes that map to a specific form field, so the user
// retries on the same input rather than seeing a generic banner.
const SERVER_ERROR_FIELD_MAP: Partial<Record<string, keyof ProfileFormValues>> = {
  CPF_INVALID: "cpf",
  CPF_REQUIRED: "cpf",
  CNPJ_INVALID: "cnpj",
  CNPJ_REQUIRED: "cnpj",
  REPRESENTANTE_CPF_INVALID: "representanteCpf",
  REPRESENTANTE_CPF_REQUIRED: "representanteCpf",
  REPRESENTANTE_NAME_REQUIRED: "representanteName",
  ALREADY_REGISTERED: "cpf",
};

export function WizardStep1({ initialValues, serverErrorCode, onSubmit, isSubmitting }: Props) {
  const t = useTranslations("onboarding.step1");

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { ...PROFILE_FORM_DEFAULTS, ...initialValues },
    mode: "onSubmit",
  });

  const { control, handleSubmit, formState, setError, setValue, resetField } = form;
  // useWatch is memoization-safe; the watch() helper from useForm() is not.
  const agencyType = useWatch({ control, name: "agencyType" });
  const errors = formState.errors;

  React.useEffect(() => {
    if (!serverErrorCode) return;
    const field = SERVER_ERROR_FIELD_MAP[serverErrorCode];
    if (field) {
      setError(field, { type: "server", message: serverErrorCode });
    }
  }, [serverErrorCode, setError]);

  const fieldError = (key: keyof ProfileFormValues): string | undefined => {
    const e = errors[key];
    if (!e?.message) return undefined;
    return t(`errors.${e.message}`);
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={handleSubmit(onSubmit)} noValidate>
      {agencyType ? (
        <div className="flex items-center gap-2">
          <span className="bg-accent size-1.5 rounded-full" aria-hidden />
          <span className="text-text text-sm font-medium">
            {agencyType === "autonomo" ? t("typeAutonomo") : t("typeEmpresa")}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span id="agency-type-label" className="text-sm font-medium">
            {t("typeLabel")}
          </span>
          <div role="group" aria-labelledby="agency-type-label" className="grid grid-cols-2 gap-2">
            {/*
              Buttons render only when no agencyType is set yet (parent ternary).
              Selecting one flips the parent branch to the "chosen" badge; we
              never display a pressed state here.
            */}
            {(["autonomo", "empresa"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={false}
                onClick={() => {
                  setValue("agencyType", type, { shouldDirty: true });
                  // Swapping type invalidates the opposite branch's identity field
                  resetField(type === "autonomo" ? "cnpj" : "cpf", { defaultValue: "" });
                }}
                className="border-border text-text-2 hover:border-text-3 hover:text-text border px-4 py-3 text-sm font-medium transition-colors"
              >
                {type === "autonomo" ? t("typeAutonomo") : t("typeEmpresa")}
              </button>
            ))}
          </div>
          {fieldError("agencyType") && (
            <p className="text-error text-xs" role="alert">
              {fieldError("agencyType")}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="name"
          render={({ field }) => (
            <Field
              id="field-name"
              label={agencyType === "empresa" ? t("nameLabelEmpresa") : t("nameLabel")}
              error={fieldError("name")}
              className="sm:col-span-2"
            >
              <Input
                {...field}
                id="field-name"
                placeholder={
                  agencyType === "empresa" ? t("namePlaceholderEmpresa") : t("namePlaceholder")
                }
                autoComplete={agencyType === "empresa" ? "organization" : "name"}
              />
            </Field>
          )}
        />

        {agencyType === "autonomo" && (
          <Controller
            control={control}
            name="cpf"
            render={({ field }) => (
              <Field id="field-cpf" label={t("cpfLabel")} error={fieldError("cpf")}>
                <Input
                  {...field}
                  id="field-cpf"
                  placeholder="000.000.000-00"
                  maxLength={14}
                  inputMode="numeric"
                  onChange={(e) => field.onChange(maskCPF(e.target.value))}
                />
              </Field>
            )}
          />
        )}

        {agencyType === "empresa" && (
          <Controller
            control={control}
            name="cnpj"
            render={({ field }) => (
              <Field id="field-cnpj" label={t("cnpjLabel")} error={fieldError("cnpj")}>
                <Input
                  {...field}
                  id="field-cnpj"
                  placeholder="00.000.000/0000-00"
                  maxLength={18}
                  inputMode="numeric"
                  onChange={(e) => field.onChange(maskCNPJ(e.target.value))}
                />
              </Field>
            )}
          />
        )}

        <Controller
          control={control}
          name="creci"
          render={({ field }) => (
            <Field id="field-creci" label={t("creciLabel")} error={fieldError("creci")}>
              <Input
                {...field}
                id="field-creci"
                placeholder={
                  agencyType === "empresa"
                    ? t("creciPlaceholderEmpresa")
                    : t("creciPlaceholderAutonomo")
                }
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <Field id="field-email" label={t("emailLabel")} error={fieldError("email")}>
              <Input
                {...field}
                id="field-email"
                type="email"
                placeholder={t("emailPlaceholder")}
                autoComplete="email"
              />
            </Field>
          )}
        />

        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <Field id="field-phone" label={t("phoneLabel")} error={fieldError("phone")}>
              <Input
                {...field}
                id="field-phone"
                type="tel"
                placeholder="(00) 00000-0000"
                maxLength={15}
                autoComplete="tel"
                onChange={(e) => field.onChange(maskPhone(e.target.value))}
              />
            </Field>
          )}
        />
      </div>

      {agencyType === "empresa" && (
        <div className="flex flex-col gap-4">
          <span className="text-text-3 font-mono text-xs tracking-wide uppercase">
            {t("representanteSection")}
          </span>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Controller
              control={control}
              name="representanteName"
              render={({ field }) => (
                <Field
                  id="field-representante-name"
                  label={t("representanteNameLabel")}
                  error={fieldError("representanteName")}
                  className="sm:col-span-2"
                >
                  <Input
                    {...field}
                    id="field-representante-name"
                    placeholder={t("representanteNamePlaceholder")}
                    autoComplete="name"
                  />
                </Field>
              )}
            />

            <Controller
              control={control}
              name="representanteCpf"
              render={({ field }) => (
                <Field
                  id="field-representante-cpf"
                  label={t("representanteCpfLabel")}
                  error={fieldError("representanteCpf")}
                >
                  <Input
                    {...field}
                    id="field-representante-cpf"
                    placeholder="000.000.000-00"
                    maxLength={14}
                    inputMode="numeric"
                    onChange={(e) => field.onChange(maskCPF(e.target.value))}
                  />
                </Field>
              )}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
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
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && (
        <p className="text-error text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
