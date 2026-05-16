"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  calcFeePreview,
  formatBRLCentsDisplay,
  type WizardData,
  type RentMultiplier,
  type ExitCostMultiplier,
} from "@/lib/contracts/wizard";

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
};

type Step2Errors = {
  rentMultiplier?: string;
  exitCostMultiplier?: string;
};

const COVERAGE_OPTIONS: { value: RentMultiplier; months: number }[] = [
  { value: "20x", months: 20 },
  { value: "30x", months: 30 },
  { value: "40x", months: 40 },
];

const EXIT_OPTIONS: { value: ExitCostMultiplier; months: number }[] = [
  { value: "3x", months: 3 },
  { value: "5x", months: 5 },
  { value: "7x", months: 7 },
];

export function WizardStep2({ data, onChange, onNext, onBack }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Step2Errors>({});

  const preview =
    data.rentCents > 0 &&
    data.rentMultiplier &&
    data.exitCostMultiplier &&
    data.score !== null
      ? calcFeePreview(
          data.rentCents,
          data.score,
          data.rentMultiplier,
          data.exitCostMultiplier,
        )
      : null;

  const handleNext = () => {
    const errs: Step2Errors = {};
    if (!data.rentMultiplier) errs.rentMultiplier = t("validation.coverageRequired");
    if (!data.exitCostMultiplier) errs.exitCostMultiplier = t("validation.exitRequired");
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    onNext();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Coverage selection */}
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("coverage.heading")}</h2>

        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm font-medium">
            {t("coverage.rentMultiplierLabel")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {COVERAGE_OPTIONS.map(({ value, months }) => (
              <OptionCard
                key={value}
                label={value}
                description={t("coverage.coverageDesc", { x: months })}
                selected={data.rentMultiplier === value}
                onSelect={() => onChange({ rentMultiplier: value })}
              />
            ))}
          </div>
          {errors.rentMultiplier && (
            <p className="text-destructive text-xs">{errors.rentMultiplier}</p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm font-medium">
            {t("coverage.exitCostLabel")}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {EXIT_OPTIONS.map(({ value, months }) => (
              <OptionCard
                key={value}
                label={value}
                description={t("coverage.exitDesc", { x: months })}
                selected={data.exitCostMultiplier === value}
                onSelect={() => onChange({ exitCostMultiplier: value })}
              />
            ))}
          </div>
          {errors.exitCostMultiplier && (
            <p className="text-destructive text-xs">{errors.exitCostMultiplier}</p>
          )}
        </div>
      </section>

      {/* Fee preview */}
      {preview && (
        <section className="flex flex-col gap-3 rounded-lg border p-4 md:p-6">
          <h2 className="text-base font-semibold">{t("coverage.preview.heading")}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <PreviewRow
              label={t("coverage.preview.fee")}
              value={formatBRLCentsDisplay(preview.feeCents)}
            />
            <PreviewRow
              label={t("coverage.preview.activationFee")}
              value={formatBRLCentsDisplay(preview.oneTimeActivationFeeCents)}
            />
            <PreviewRow
              label={t("coverage.preview.guarantee")}
              value={formatBRLCentsDisplay(preview.availableGuaranteeCents)}
            />
          </div>
        </section>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("nav.back")}
        </Button>
        <Button onClick={handleNext}>{t("nav.nextStep3")}</Button>
      </div>
    </div>
  );
}

function OptionCard({
  label,
  description,
  selected,
  onSelect,
}: {
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/5 text-primary"
          : "border-input hover:bg-accent",
      )}
    >
      <span className="font-semibold">{label}</span>
      <span className={cn("text-xs leading-tight", selected ? "text-primary/70" : "text-muted-foreground")}>
        {description}
      </span>
    </button>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono font-medium">{value}</span>
    </div>
  );
}
