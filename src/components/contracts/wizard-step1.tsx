"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  isValidCPF,
  parseBRLInput,
  formatBRLCentsDisplay,
  type WizardData,
  type ScoreTier,
} from "@/lib/contracts/wizard";

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
};

const step1Schema = z.object({
  propertyKind: z.union([z.literal("residencial"), z.literal("comercial")]),
  cep: z.string().regex(/^\d{8}$/, "cepInvalid"),
  streetAndNumber: z.string().min(1, "required"),
  neighborhood: z.string().min(1, "required"),
  cityUF: z.string().min(1, "required"),
  rentCents: z.number().min(1, "rentRequired"),
  fullName: z.string().min(1, "required"),
  cpf: z.string().refine(isValidCPF, "cpfInvalid"),
  birthDate: z
    .string()
    .min(1, "required")
    .refine((v) => !isNaN(Date.parse(v)), "birthDateInvalid")
    .refine((v) => new Date(v) <= new Date(), "birthDateFuture"),
  email: z.string().email("emailInvalid"),
  phone: z.string().min(1, "required"),
  score: z.number(),
});

type ErrorCode =
  | "required"
  | "cpfInvalid"
  | "cepInvalid"
  | "rentRequired"
  | "birthDateInvalid"
  | "birthDateFuture"
  | "emailInvalid";

type Errors = Partial<Record<keyof typeof step1Schema.shape, ErrorCode>>;

const TIER_STYLE: Record<ScoreTier, string> = {
  bom: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  regular: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  ruim: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function WizardStep1({ data, onChange, onNext }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Errors>({});
  const [cpfForLookup, setCpfForLookup] = React.useState<string | null>(null);
  const [rentInput, setRentInput] = React.useState(
    data.rentCents > 0 ? (data.rentCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [condoInput, setCondoInput] = React.useState(
    data.condoCents > 0 ? (data.condoCents / 100).toFixed(2).replace(".", ",") : "",
  );
  const [otherInput, setOtherInput] = React.useState(
    data.otherFeesCents > 0 ? (data.otherFeesCents / 100).toFixed(2).replace(".", ",") : "",
  );

  const scoreResult = useQuery(
    api.contracts.useCases.lookupTenantScore,
    cpfForLookup ? { cpf: cpfForLookup } : "skip",
  );

  React.useEffect(() => {
    if (!cpfForLookup || scoreResult === undefined) return;
    onChange({ score: scoreResult.score, scoreTier: scoreResult.tier });
  }, [cpfForLookup, scoreResult, onChange]);

  const handleCpfBlur = () => {
    const cpf = data.cpf;
    if (isValidCPF(cpf)) {
      setCpfForLookup(cpf);
      onChange({ score: null, scoreTier: null });
    }
  };

  const handleCurrencyBlur = (
    raw: string,
    field: "rentCents" | "condoCents" | "otherFeesCents",
  ) => {
    onChange({ [field]: parseBRLInput(raw) });
  };

  const totalRentCents = data.rentCents + data.condoCents + data.otherFeesCents;

  function resolveError(code: ErrorCode | undefined): string | undefined {
    if (!code) return undefined;
    switch (code) {
      case "required":
        return t("validation.required");
      case "cpfInvalid":
        return t("validation.cpfInvalid");
      case "cepInvalid":
        return t("validation.cepInvalid");
      case "rentRequired":
        return t("validation.rentRequired");
      case "birthDateInvalid":
        return t("validation.birthDateInvalid");
      case "birthDateFuture":
        return t("validation.birthDateFuture");
      case "emailInvalid":
        return t("validation.emailInvalid");
    }
  }

  const tierLabel: Record<ScoreTier, string> = {
    bom: t("tenant.scoreBom"),
    regular: t("tenant.scoreRegular"),
    ruim: t("tenant.scoreRuim"),
  };

  const handleNext = () => {
    const result = step1Schema.safeParse({
      propertyKind: data.propertyKind || undefined,
      cep: data.cep.replace(/\D/g, ""),
      streetAndNumber: data.streetAndNumber,
      neighborhood: data.neighborhood,
      cityUF: data.cityUF,
      rentCents: data.rentCents,
      fullName: data.fullName,
      cpf: data.cpf,
      birthDate: data.birthDate,
      email: data.email,
      phone: data.phone,
      score: data.score ?? undefined,
    });

    if (!result.success) {
      const errs: Errors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof Errors;
        if (!errs[key]) errs[key] = issue.message as ErrorCode;
      }
      setErrors(errs);
      return;
    }

    setErrors({});
    onNext();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Property section */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("property.heading")}</h2>

        <div className="flex flex-col gap-2">
          <Label>{t("property.kindLabel")}</Label>
          <div className="flex gap-2">
            {(["residencial", "comercial"] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => onChange({ propertyKind: kind })}
                className={cn(
                  "flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  data.propertyKind === kind
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-input hover:bg-accent",
                )}
              >
                {kind === "residencial" ? t("property.residencial") : t("property.comercial")}
              </button>
            ))}
          </div>
          {errors.propertyKind && (
            <p className="text-destructive text-xs">{t("validation.required")}</p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("property.cep")} error={resolveError(errors.cep)}>
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

          <Field
            label={t("property.streetAndNumber")}
            error={resolveError(errors.streetAndNumber)}
          >
            <Input
              value={data.streetAndNumber}
              onChange={(e) => onChange({ streetAndNumber: e.target.value })}
            />
          </Field>

          <Field label={t("property.neighborhood")} error={resolveError(errors.neighborhood)}>
            <Input
              value={data.neighborhood}
              onChange={(e) => onChange({ neighborhood: e.target.value })}
            />
          </Field>

          <Field label={t("property.cityUF")} error={resolveError(errors.cityUF)}>
            <Input
              placeholder="São Paulo / SP"
              value={data.cityUF}
              onChange={(e) => onChange({ cityUF: e.target.value })}
            />
          </Field>

          <Field label={t("property.complement")} className="sm:col-span-2">
            <Input
              value={data.complement}
              onChange={(e) => onChange({ complement: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* Rent section */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("rent.heading")}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("rent.rent")} error={resolveError(errors.rentCents)}>
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

        <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2">
          <span className="text-muted-foreground text-sm">{t("rent.total")}</span>
          <span className="font-mono font-medium">{formatBRLCentsDisplay(totalRentCents)}</span>
        </div>
      </section>

      {/* Tenant section */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("tenant.heading")}</h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={t("tenant.fullName")}
            error={resolveError(errors.fullName)}
            className="sm:col-span-2"
          >
            <Input
              value={data.fullName}
              onChange={(e) => onChange({ fullName: e.target.value })}
            />
          </Field>

          <Field label={t("tenant.cpf")} error={resolveError(errors.cpf)}>
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
                setCpfForLookup(null);
              }}
              onBlur={handleCpfBlur}
            />
          </Field>

          <Field label={t("tenant.scoreLabel")} error={resolveError(errors.score)}>
            {cpfForLookup && scoreResult === undefined ? (
              <Skeleton className="h-9 w-full rounded-md" />
            ) : data.score !== null && data.scoreTier !== null ? (
              <div
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium",
                  TIER_STYLE[data.scoreTier],
                )}
              >
                {data.score} — {tierLabel[data.scoreTier]}
              </div>
            ) : (
              <div className="text-muted-foreground flex h-9 items-center text-sm">
                {cpfForLookup ? t("tenant.scoreLoading") : "—"}
              </div>
            )}
          </Field>

          <Field label={t("tenant.birthDate")} error={resolveError(errors.birthDate)}>
            <Input
              type="date"
              value={data.birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => onChange({ birthDate: e.target.value })}
            />
          </Field>

          <Field label={t("tenant.email")} error={resolveError(errors.email)}>
            <Input
              type="email"
              value={data.email}
              onChange={(e) => onChange({ email: e.target.value })}
            />
          </Field>

          <Field label={t("tenant.phone")} error={resolveError(errors.phone)}>
            <Input
              value={data.phone}
              onChange={(e) => onChange({ phone: e.target.value })}
            />
          </Field>
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
      <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 select-none text-sm">
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
