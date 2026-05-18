"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isValidCPF, isValidCNPJ, maskCPF, maskCNPJ, maskPhone } from "@/lib/brazil";
import type { OnboardingWizardData } from "@/components/onboarding/onboarding-wizard";

type Props = {
  data: OnboardingWizardData;
  onChange: (patch: Partial<OnboardingWizardData>) => void;
  onNext: (agencyType: "autonomo" | "empresa") => void;
  isSubmitting: boolean;
};

type Errors = Partial<Record<keyof OnboardingWizardData, string>>;

function isAgencyTypeSelected(t: string): t is "autonomo" | "empresa" {
  return t === "autonomo" || t === "empresa";
}

export function WizardStep1({ data, onChange, onNext, isSubmitting }: Props) {
  const t = useTranslations("onboarding.step1");
  const [errors, setErrors] = React.useState<Errors>({});

  const handleNext = () => {
    const errs: Errors = {};

    if (!isAgencyTypeSelected(data.agencyType)) errs.agencyType = t("errors.agencyType");
    if (!data.name.trim()) errs.name = t("errors.name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errs.email = t("errors.email");
    if (data.phone.replace(/\D/g, "").length < 10) errs.phone = t("errors.phone");
    if (!data.creci.trim()) errs.creci = t("errors.creci");

    if (data.agencyType === "autonomo") {
      if (!isValidCPF(data.cpf)) errs.cpf = t("errors.cpf");
    }
    if (data.agencyType === "empresa") {
      if (!isValidCNPJ(data.cnpj)) errs.cnpj = t("errors.cnpj");
      if (!data.representanteName.trim()) errs.representanteName = t("errors.representanteName");
      if (!isValidCPF(data.representanteCpf)) errs.representanteCpf = t("errors.representanteCpf");
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    if (!isAgencyTypeSelected(data.agencyType)) return;

    setErrors({});
    onNext(data.agencyType);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Tipo de cadastro — oculto se já foi selecionado na tela de boas-vindas */}
      {data.agencyType ? (
        <div className="flex items-center gap-2">
          <span className="bg-accent size-1.5 rounded-full" aria-hidden />
          <span className="text-text text-sm font-medium">
            {data.agencyType === "autonomo" ? t("typeAutonomo") : t("typeEmpresa")}
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span id="agency-type-label" className="text-sm font-medium">
            {t("typeLabel")}
          </span>
          <div role="group" aria-labelledby="agency-type-label" className="grid grid-cols-2 gap-2">
            {(["autonomo", "empresa"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={data.agencyType === type}
                onClick={() => onChange({ agencyType: type, cpf: "", cnpj: "" })}
                className={cn(
                  "border px-4 py-3 text-sm font-medium transition-colors",
                  data.agencyType === type
                    ? "border-accent bg-accent/5 text-accent"
                    : "border-border text-text-2 hover:border-text-3 hover:text-text",
                )}
              >
                {type === "autonomo" ? t("typeAutonomo") : t("typeEmpresa")}
              </button>
            ))}
          </div>
          {errors.agencyType && (
            <p className="text-error text-xs" role="alert">
              {errors.agencyType}
            </p>
          )}
        </div>
      )}

      {/* Campos comuns */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="field-name"
          label={data.agencyType === "empresa" ? t("nameLabelEmpresa") : t("nameLabel")}
          error={errors.name}
          className="sm:col-span-2"
        >
          <Input
            id="field-name"
            value={data.name}
            placeholder={
              data.agencyType === "empresa" ? t("namePlaceholderEmpresa") : t("namePlaceholder")
            }
            autoComplete={data.agencyType === "empresa" ? "organization" : "name"}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Field>

        {data.agencyType === "autonomo" && (
          <Field id="field-cpf" label={t("cpfLabel")} error={errors.cpf}>
            <Input
              id="field-cpf"
              value={data.cpf}
              placeholder="000.000.000-00"
              maxLength={14}
              inputMode="numeric"
              onChange={(e) => onChange({ cpf: maskCPF(e.target.value) })}
            />
          </Field>
        )}

        {data.agencyType === "empresa" && (
          <Field id="field-cnpj" label={t("cnpjLabel")} error={errors.cnpj}>
            <Input
              id="field-cnpj"
              value={data.cnpj}
              placeholder="00.000.000/0000-00"
              maxLength={18}
              inputMode="numeric"
              onChange={(e) => onChange({ cnpj: maskCNPJ(e.target.value) })}
            />
          </Field>
        )}

        <Field id="field-creci" label={t("creciLabel")} error={errors.creci}>
          <Input
            id="field-creci"
            value={data.creci}
            placeholder={
              data.agencyType === "empresa"
                ? t("creciPlaceholderEmpresa")
                : t("creciPlaceholderAutonomo")
            }
            onChange={(e) => onChange({ creci: e.target.value })}
          />
        </Field>

        <Field id="field-email" label={t("emailLabel")} error={errors.email}>
          <Input
            id="field-email"
            type="email"
            value={data.email}
            placeholder={t("emailPlaceholder")}
            autoComplete="email"
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </Field>

        <Field id="field-phone" label={t("phoneLabel")} error={errors.phone}>
          <Input
            id="field-phone"
            type="tel"
            value={data.phone}
            placeholder="(00) 00000-0000"
            maxLength={15}
            autoComplete="tel"
            onChange={(e) => onChange({ phone: maskPhone(e.target.value) })}
          />
        </Field>
      </div>

      {data.agencyType === "empresa" && (
        <div className="flex flex-col gap-4">
          <span className="text-text-3 font-mono text-xs tracking-wide uppercase">
            {t("representanteSection")}
          </span>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="field-representante-name"
              label={t("representanteNameLabel")}
              error={errors.representanteName}
              className="sm:col-span-2"
            >
              <Input
                id="field-representante-name"
                value={data.representanteName}
                placeholder={t("representanteNamePlaceholder")}
                autoComplete="name"
                onChange={(e) => onChange({ representanteName: e.target.value })}
              />
            </Field>

            <Field
              id="field-representante-cpf"
              label={t("representanteCpfLabel")}
              error={errors.representanteCpf}
            >
              <Input
                id="field-representante-cpf"
                value={data.representanteCpf}
                placeholder="000.000.000-00"
                maxLength={14}
                inputMode="numeric"
                onChange={(e) => onChange({ representanteCpf: maskCPF(e.target.value) })}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button size="lg" onClick={handleNext} disabled={isSubmitting}>
          {isSubmitting ? t("savingButton") : t("nextButton")}
        </Button>
      </div>
    </div>
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
