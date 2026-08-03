"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { CurrencyInput } from "@mutav/ui/currency-input";
import { Field } from "@mutav/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import {
  isPropertyKind,
  isTenantEntityType,
  parseBRLInput,
  type DraftWizardData,
} from "@/lib/contracts/wizard";
import { maskCPF, maskCNPJ, isValidCPF, isValidCNPJ } from "@mutav/i18n/brazil";
import { formatBRLCents } from "@/lib/contracts/format";

type Props = {
  data: DraftWizardData;
  agencyId: AgencyId;
  onChange: (patch: Partial<DraftWizardData>) => void;
  onNext: () => void;
};

type Errors = Partial<Record<string, string>>;

export function WizardStep1({ data, agencyId, onChange, onNext }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Errors>({});
  const [isOpeningApplication, setIsOpeningApplication] = React.useState(false);
  const openApplication = useMutation(api.contracts.useCases.openContractApplication);
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

  // Advancing records the agency's declared intent to rent to this subject.
  // That record — not the wizard reaching step 2 — is what authorises the
  // bureau consultation step 2 requests.
  const handleNext = async () => {
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

    if (Object.keys(errs).length > 0 || !isPropertyKind(data.propertyKind)) {
      setErrors(errs);
      return;
    }

    setIsOpeningApplication(true);
    try {
      const result = await openApplication({
        agencyId,
        document: isPJ ? data.cnpj : data.cpf,
        entityType: isPJ ? "pj" : "pf",
        propertyKind: data.propertyKind,
        cep: data.cep,
        rentCents: data.rentCents,
      });
      if (!result.success) {
        setErrors({ doc: t(`errors.${result.error.code}`) });
        return;
      }
    } catch {
      setErrors({ doc: t("errors.applicationFailed") });
      return;
    } finally {
      setIsOpeningApplication(false);
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
              if (!isTenantEntityType(v)) return;
              onChange({
                entityType: v,
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
              if (!isPropertyKind(v)) return;
              onChange({ propertyKind: v });
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
          <span className="font-mono font-medium">{formatBRLCents(totalRentCents)}</span>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={handleNext} disabled={isOpeningApplication}>
          {t("nav.nextStep2")}
        </Button>
      </div>
    </div>
  );
}
