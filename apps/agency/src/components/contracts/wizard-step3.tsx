"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { LockIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { type WizardData } from "@/lib/contracts/wizard";

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
};

type ErrorCode =
  | "required"
  | "emailInvalid"
  | "birthDateInvalid"
  | "birthDateFuture"
  | "fullNameRequired";

type Errors = Partial<Record<string, ErrorCode>>;

export function WizardStep3({ data, onChange, onNext, onBack }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Errors>({});
  const [nameFromLookup] = React.useState(!!data.fullName);

  function resolveError(code: ErrorCode | undefined): string | undefined {
    if (!code) return undefined;
    switch (code) {
      case "required":
        return t("validation.required");
      case "fullNameRequired":
        return t("validation.required");
      case "emailInvalid":
        return t("validation.emailInvalid");
      case "birthDateInvalid":
        return t("validation.birthDateInvalid");
      case "birthDateFuture":
        return t("validation.birthDateFuture");
    }
  }

  const handleNext = () => {
    const errs: Errors = {};

    if (!data.fullName.trim()) errs.fullName = "fullNameRequired";

    if (data.entityType === "pf") {
      if (!data.birthDate) {
        errs.birthDate = "required";
      } else if (isNaN(Date.parse(data.birthDate))) {
        errs.birthDate = "birthDateInvalid";
      } else if (new Date(data.birthDate) > new Date()) {
        errs.birthDate = "birthDateFuture";
      }
    }

    if (!z.string().email().safeParse(data.email).success) errs.email = "emailInvalid";
    if (!data.phone.trim()) errs.phone = "required";
    if (!data.cep.trim()) errs.cep = "required";
    if (!data.street.trim()) errs.street = "required";
    if (!data.addressNumber.trim()) errs.addressNumber = "required";
    if (!data.neighborhood.trim()) errs.neighborhood = "required";
    if (!data.city.trim()) errs.city = "required";
    if (!data.uf.trim()) errs.uf = "required";

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onNext();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Tenant complementary data */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("complementary.tenantSection")}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Name — locked when populated from CPF lookup, editable otherwise */}
          {nameFromLookup ? (
            <LockedField
              label={data.entityType === "pj" ? t("tenant.companyName") : t("tenant.fullName")}
              value={data.fullName}
              className="sm:col-span-2"
            />
          ) : (
            <Field
              label={data.entityType === "pj" ? t("tenant.companyName") : t("tenant.fullName")}
              error={resolveError(errors.fullName)}
              className="sm:col-span-2"
            >
              <Input
                value={data.fullName}
                onChange={(e) => onChange({ fullName: e.target.value })}
              />
            </Field>
          )}

          {/* CPF/CNPJ — locked */}
          <LockedField
            label={data.entityType === "pj" ? t("tenant.cnpj") : t("tenant.cpf")}
            value={data.entityType === "pj" ? data.cnpj : data.cpf}
          />

          {data.entityType === "pf" && (
            <Field label={t("tenant.birthDate")} error={resolveError(errors.birthDate)}>
              <Input
                type="date"
                value={data.birthDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => onChange({ birthDate: e.target.value })}
              />
            </Field>
          )}

          <Field label={t("tenant.email")} error={resolveError(errors.email)}>
            <Input
              type="email"
              value={data.email}
              onChange={(e) => onChange({ email: e.target.value })}
            />
          </Field>

          <Field label={t("tenant.phone")} error={resolveError(errors.phone)}>
            <Input value={data.phone} onChange={(e) => onChange({ phone: e.target.value })} />
          </Field>
        </div>
      </section>

      {/* Property address */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("complementary.addressSection")}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("property.cep")} error={resolveError(errors.cep)}>
            <Input
              placeholder="00000-000"
              maxLength={9}
              value={data.cep}
              onChange={(e) => onChange({ cep: e.target.value })}
            />
          </Field>

          <div className="grid grid-cols-[1fr_auto] gap-3 sm:col-span-2">
            <Field label={t("property.street")} error={resolveError(errors.street)}>
              <Input value={data.street} onChange={(e) => onChange({ street: e.target.value })} />
            </Field>
            <Field
              label={t("property.addressNumber")}
              error={resolveError(errors.addressNumber)}
              className="w-28"
            >
              <Input
                value={data.addressNumber}
                onChange={(e) => onChange({ addressNumber: e.target.value })}
              />
            </Field>
          </div>

          <Field label={t("property.neighborhood")} error={resolveError(errors.neighborhood)}>
            <Input
              value={data.neighborhood}
              onChange={(e) => onChange({ neighborhood: e.target.value })}
            />
          </Field>

          <Field label={t("property.complement")}>
            <Input
              value={data.complement}
              onChange={(e) => onChange({ complement: e.target.value })}
            />
          </Field>

          <Field label={t("property.city")} error={resolveError(errors.city)}>
            <Input value={data.city} onChange={(e) => onChange({ city: e.target.value })} />
          </Field>

          <Field label={t("property.uf")} error={resolveError(errors.uf)}>
            <Input
              placeholder="SP"
              maxLength={2}
              className="uppercase"
              value={data.uf}
              onChange={(e) => onChange({ uf: e.target.value.toUpperCase() })}
            />
          </Field>
        </div>
      </section>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("nav.back")}
        </Button>
        <Button onClick={handleNext}>{t("nav.nextStep4")}</Button>
      </div>
    </div>
  );
}

function LockedField({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <Label className="text-muted-foreground">{label}</Label>
        <LockIcon className="text-muted-foreground/60 h-3 w-3" />
      </div>
      <div className="bg-muted/50 border-input text-muted-foreground rounded-md border px-3 py-2 font-mono text-sm">
        {value}
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
