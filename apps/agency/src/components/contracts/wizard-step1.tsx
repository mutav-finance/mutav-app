"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { cn } from "@mutav/ui/cn";
import { isValidCPF, isValidCNPJ, type WizardData } from "@/lib/contracts/wizard";
import { maskCPF, maskCNPJ } from "@mutav/i18n/brazil";
import { formatBRLCents, formatCentsPlain } from "@/lib/contracts/format";

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
};

type Errors = Partial<Record<string, string>>;

export function WizardStep1({ data, onChange, onNext }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Errors>({});

  const totalRentCents = data.rentCents + data.condoCents + data.otherFeesCents;

  const handleNext = () => {
    const errs: Errors = {};

    if (!data.propertyKind) errs.propertyKind = t("validation.required");

    const isPJ = data.entityType === "pj";
    if (isPJ) {
      if (!isValidCNPJ(data.cnpj)) errs.doc = t("validation.cnpjInvalid");
    } else {
      if (!isValidCPF(data.cpf)) errs.doc = t("validation.cpfInvalid");
    }

    if (data.cep.replace(/\D/g, "").length !== 8) errs.cep = t("validation.cepInvalid");
    if (data.rentCents <= 0) errs.rentCents = t("validation.rentRequired");

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onNext();
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        {/* 1. Tipo de pessoa */}
        <div className="flex flex-col gap-2">
          <Label>{t("step1.entityTypeLabel")}</Label>
          <ToggleGroup
            type="single"
            value={data.entityType}
            onValueChange={(v) => {
              if (!v) return;
              onChange({
                entityType: v as "pf" | "pj",
                cpf: "",
                cnpj: "",
                score: null,
                scoreTier: null,
              });
            }}
            variant="outline"
            spacing={2}
            className="w-full *:data-[slot=toggle-group-item]:flex-1"
          >
            <ToggleGroupItem value="pf">{t("step1.pf")}</ToggleGroupItem>
            <ToggleGroupItem value="pj">{t("step1.pj")}</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* 2. CPF / CNPJ — sempre visível, troca conforme seleção */}
        {data.entityType !== "pj" ? (
          <Field label="CPF" error={errors.doc}>
            <Input
              value={data.cpf}
              placeholder={t("tenant.cpfPlaceholder")}
              maxLength={14}
              onChange={(e) => {
                onChange({ cpf: maskCPF(e.target.value), score: null, scoreTier: null });
              }}
            />
          </Field>
        ) : (
          <Field label="CNPJ" error={errors.doc}>
            <Input
              value={data.cnpj}
              placeholder={t("step1.cnpjPlaceholder")}
              maxLength={18}
              onChange={(e) => {
                onChange({ cnpj: maskCNPJ(e.target.value), score: null, scoreTier: null });
              }}
            />
          </Field>
        )}

        {/* 3. Tipo de imóvel */}
        <div className="flex flex-col gap-2">
          <Label>{t("property.kindLabel")}</Label>
          <ToggleGroup
            type="single"
            value={data.propertyKind ?? ""}
            onValueChange={(v) => {
              if (!v) return;
              onChange({ propertyKind: v as "residencial" | "comercial" });
            }}
            variant="outline"
            spacing={2}
            className="w-full *:data-[slot=toggle-group-item]:flex-1"
          >
            <ToggleGroupItem value="residencial">{t("property.residencial")}</ToggleGroupItem>
            <ToggleGroupItem value="comercial">{t("property.comercial")}</ToggleGroupItem>
          </ToggleGroup>
          {errors.propertyKind && <p className="text-destructive text-xs">{errors.propertyKind}</p>}
        </div>

        {/* 4. CEP */}
        <Field label={t("property.cep")} error={errors.cep}>
          <Input
            value={data.cep}
            maxLength={9}
            placeholder="00000-000"
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "").slice(0, 8);
              const masked = raw.length > 5 ? `${raw.slice(0, 5)}-${raw.slice(5)}` : raw;
              onChange({ cep: masked });
            }}
          />
        </Field>
      </section>

      {/* 5. Valores */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("rent.heading")}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("rent.rent")} error={errors.rentCents}>
            <CurrencyInput
              cents={data.rentCents}
              onChange={(cents) => onChange({ rentCents: cents })}
              placeholder={t("rent.placeholder")}
            />
          </Field>

          <Field label={t("rent.condo")}>
            <CurrencyInput
              cents={data.condoCents}
              onChange={(cents) => onChange({ condoCents: cents })}
              placeholder={t("rent.placeholder")}
            />
          </Field>

          <Field label={t("rent.otherFees")}>
            <CurrencyInput
              cents={data.otherFeesCents}
              onChange={(cents) => onChange({ otherFeesCents: cents })}
              placeholder={t("rent.placeholder")}
            />
          </Field>
        </div>

        <div className="bg-muted/50 flex items-center justify-between rounded-md px-3 py-2">
          <span className="text-muted-foreground text-sm">{t("rent.total")}</span>
          <span className="font-mono font-medium">{formatBRLCents(totalRentCents)}</span>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleNext}>{t("nav.nextStep2")}</Button>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function CurrencyInput({
  cents,
  onChange,
  placeholder,
}: {
  cents: number;
  onChange: (cents: number) => void;
  placeholder?: string;
}) {
  const display = cents > 0 ? formatCentsPlain(cents) : "";

  return (
    <div className="relative">
      <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm select-none">
        R$
      </span>
      <Input
        className="pl-8"
        value={display}
        placeholder={placeholder}
        inputMode="numeric"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, "");
          onChange(digits ? Number.parseInt(digits, 10) : 0);
        }}
      />
    </div>
  );
}
