"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  isValidCPF,
  isValidCNPJ,
  parseBRLInput,
  formatBRLCentsDisplay,
  type WizardData,
} from "@/lib/contracts/wizard";

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
};

type Errors = Partial<Record<string, string>>;

export function WizardStep1({ data, onChange, onNext }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Errors>({});
  const [rentInput, setRentInput] = React.useState(
    data.rentCents > 0 ? (data.rentCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [condoInput, setCondoInput] = React.useState(
    data.condoCents > 0 ? (data.condoCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [otherInput, setOtherInput] = React.useState(
    data.otherFeesCents > 0 ? (data.otherFeesCents / 100).toFixed(2).replace(".", ",") : "",
  );

  const handleCurrencyBlur = (
    raw: string,
    field: "rentCents" | "condoCents" | "otherFeesCents",
  ) => {
    onChange({ [field]: parseBRLInput(raw) });
  };

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
                const raw = e.target.value.replace(/\D/g, "").slice(0, 11);
                const masked =
                  raw.length > 9
                    ? `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9)}`
                    : raw.length > 6
                      ? `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6)}`
                      : raw.length > 3
                        ? `${raw.slice(0, 3)}.${raw.slice(3)}`
                        : raw;
                onChange({ cpf: masked, score: null, scoreTier: null });
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
                const raw = e.target.value.replace(/\D/g, "").slice(0, 14);
                let masked = raw;
                if (raw.length > 12)
                  masked = `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8, 12)}-${raw.slice(12)}`;
                else if (raw.length > 8)
                  masked = `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}/${raw.slice(8)}`;
                else if (raw.length > 5)
                  masked = `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5)}`;
                else if (raw.length > 2) masked = `${raw.slice(0, 2)}.${raw.slice(2)}`;
                onChange({ cnpj: masked, score: null, scoreTier: null });
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
              value={rentInput}
              onChange={setRentInput}
              onBlur={(v) => handleCurrencyBlur(v, "rentCents")}
              placeholder={t("rent.placeholder")}
            />
          </Field>

          <Field label={t("rent.condo")}>
            <CurrencyInput
              value={condoInput}
              onChange={setCondoInput}
              onBlur={(v) => handleCurrencyBlur(v, "condoCents")}
              placeholder={t("rent.placeholder")}
            />
          </Field>

          <Field label={t("rent.otherFees")}>
            <CurrencyInput
              value={otherInput}
              onChange={setOtherInput}
              onBlur={(v) => handleCurrencyBlur(v, "otherFeesCents")}
              placeholder={t("rent.placeholder")}
            />
          </Field>
        </div>

        <div className="bg-muted/50 flex items-center justify-between rounded-md px-3 py-2">
          <span className="text-muted-foreground text-sm">{t("rent.total")}</span>
          <span className="font-mono font-medium">{formatBRLCentsDisplay(totalRentCents)}</span>
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
  value,
  onChange,
  onBlur,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm select-none">
        R$
      </span>
      <Input
        className="pl-8"
        value={value}
        placeholder={placeholder}
        inputMode="decimal"
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value)}
      />
    </div>
  );
}
