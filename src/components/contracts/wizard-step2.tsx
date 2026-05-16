"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/providers/workspace";
import {
  calcFeePreview,
  formatBRLCentsDisplay,
  type WizardData,
  type RentMultiplier,
  type ExitCostMultiplier,
  type ScoreTier,
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
  { value: "24x", months: 24 },
  { value: "36x", months: 36 },
  { value: "48x", months: 48 },
];

const EXIT_OPTIONS: { value: ExitCostMultiplier; months: number }[] = [
  { value: "3x", months: 3 },
  { value: "5x", months: 5 },
  { value: "7x", months: 7 },
];

const EXIT_MONTHS: Record<ExitCostMultiplier, number> = { "3x": 3, "5x": 5, "7x": 7 };

const TIER_STYLE: Record<ScoreTier, string> = {
  bom: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  regular: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  ruim: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  negado: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const TIER_CARD_STYLE: Record<ScoreTier, string> = {
  bom: "border-green-500 bg-green-50/50 dark:bg-green-950/20",
  regular: "border-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20",
  ruim: "border-orange-500 bg-orange-50/50 dark:bg-orange-950/20",
  negado: "border-red-500 bg-red-50/50 dark:bg-red-950/20",
};

export function WizardStep2({ data, onChange, onNext, onBack }: Props) {
  const t = useTranslations("contractNew");
  const [errors, setErrors] = React.useState<Step2Errors>({});
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id as Id<"agencies"> | undefined;

  const cpfDigits = data.entityType === "pj" ? "" : data.cpf.replace(/\D/g, "");
  const docDigits = data.entityType === "pj" ? data.cnpj.replace(/\D/g, "") : cpfDigits;

  const scoreResult = useQuery(
    api.contracts.useCases.lookupTenantScore,
    docDigits ? { document: docDigits } : "skip",
  );

  const tenantLookup = useQuery(
    api.contracts.useCases.lookupTenantByCpf,
    agencyId && cpfDigits ? { agencyId, cpf: cpfDigits } : "skip",
  );

  React.useEffect(() => {
    if (scoreResult === undefined) return;
    onChange({ score: scoreResult.score, scoreTier: scoreResult.tier });
  }, [scoreResult, onChange]);

  React.useEffect(() => {
    if (!tenantLookup) return;
    onChange({ fullName: tenantLookup.fullName, email: tenantLookup.email });
  }, [tenantLookup, onChange]);

  const isLoading = scoreResult === undefined;
  const isNegado = data.score !== null && data.score < 400;

  const preview =
    !isNegado &&
    data.rentCents > 0 &&
    data.rentMultiplier &&
    data.exitCostMultiplier &&
    data.score !== null
      ? calcFeePreview(
          data.rentCents,
          data.score,
          data.rentMultiplier as RentMultiplier,
          data.exitCostMultiplier as ExitCostMultiplier,
        )
      : null;

  const tierLabel: Record<ScoreTier, string> = {
    bom: t("tenant.scoreBom"),
    regular: t("tenant.scoreRegular"),
    ruim: t("tenant.scoreRuim"),
    negado: t("tenant.scoreNegado"),
  };

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
      {/* Score result */}
      <section
        className={cn(
          "flex flex-col gap-3 rounded-lg border-2 p-4 transition-colors md:p-6",
          data.scoreTier ? TIER_CARD_STYLE[data.scoreTier] : "border-border",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{t("simulation.heading")}</h2>
          <div className="flex flex-col items-end gap-0.5 text-right">
            <span className="text-muted-foreground font-mono text-xs">
              {data.entityType === "pj" ? data.cnpj || "—" : data.cpf || "—"}
            </span>
            {data.fullName ? (
              <span className="text-sm font-medium">{data.fullName}</span>
            ) : (
              <span className="text-muted-foreground/50 text-sm select-none">—</span>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-32 rounded-md" />
              <Skeleton className="h-4 w-64 rounded" />
            </div>
            <Skeleton className="h-12 w-36 rounded-md" />
          </div>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <span className="font-mono text-3xl font-bold">{data.score}</span>
                {data.scoreTier && (
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium",
                      TIER_STYLE[data.scoreTier],
                    )}
                  >
                    {tierLabel[data.scoreTier]}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {isNegado ? t("simulation.deniedMessage") : t("simulation.approvedMessage")}
              </p>
            </div>

            {!isNegado && data.rentCents > 0 && (
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-muted-foreground text-xs">
                  {t("simulation.approvedValueLabel")}
                </span>
                <span className="font-mono text-2xl font-bold">
                  {formatBRLCentsDisplay(data.rentCents)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Coverage — only when approved and score loaded */}
      {!isLoading && !isNegado && (
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
      )}

      {/* Summary block — always visible once approved, values fill in as options are selected */}
      {!isLoading && !isNegado && (
        <section className="flex flex-col gap-3 rounded-lg border p-4 md:p-6">
          <h2 className="text-base font-semibold">{t("coverage.summary.heading")}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryRow
              label={t("coverage.summary.exitCost")}
              value={
                data.exitCostMultiplier && data.rentCents > 0
                  ? formatBRLCentsDisplay(
                      EXIT_MONTHS[data.exitCostMultiplier as ExitCostMultiplier] * data.rentCents,
                    )
                  : null
              }
            />
            <SummaryRow
              label={t("coverage.summary.fee")}
              value={preview ? formatBRLCentsDisplay(preview.feeCents) : null}
            />
            <SummaryRow
              label={t("coverage.summary.commission")}
              value={preview ? formatBRLCentsDisplay(Math.round(preview.feeCents * 0.015)) : null}
            />
            <SummaryRow
              label={t("coverage.summary.guarantee")}
              value={preview ? formatBRLCentsDisplay(Math.round(preview.feeCents * 1.015)) : null}
              highlight
            />
          </div>
        </section>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack}>
          {t("nav.back")}
        </Button>
        {isNegado ? (
          <Button variant="outline" asChild>
            <Link href="/">{t("simulation.closeButton")}</Link>
          </Button>
        ) : (
          <Button onClick={handleNext}>{t("nav.nextStep3")}</Button>
        )}
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
        selected ? "border-primary bg-primary/5 text-primary" : "border-input hover:bg-accent",
      )}
    >
      <span className="font-semibold">{label}</span>
      <span
        className={cn(
          "text-xs leading-tight",
          selected ? "text-primary/70" : "text-muted-foreground",
        )}
      >
        {description}
      </span>
    </button>
  );
}

function SummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md p-3",
        highlight ? "bg-primary/8" : "bg-muted/50",
      )}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      {value !== null ? (
        <span
          className={cn("font-mono text-sm font-semibold", highlight && "text-primary text-base")}
        >
          {value}
        </span>
      ) : (
        <span className="text-muted-foreground/50 font-normal select-none">—</span>
      )}
    </div>
  );
}
