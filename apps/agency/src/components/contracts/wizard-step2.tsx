"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@mutav/ui/button";
import { Link } from "@mutav/i18n/navigation";
import { Skeleton } from "@mutav/ui/skeleton";
import { cn } from "@mutav/ui/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";
import { CheckIcon } from "lucide-react";
import { useWorkspace } from "@/providers/workspace";
import { type DraftWizardData } from "@/lib/contracts/wizard";
import { formatBRLCents } from "@/lib/contracts/format";
import { CONTRACT_PLAN, type ScoreTier } from "@convex/contracts/domain";
import { priceContract, splitCommission, DEFAULT_PRICING_TABLE } from "@convex/contracts/pricing";

type Props = {
  data: DraftWizardData;
  onChange: (patch: Partial<DraftWizardData>) => void;
  onNext: () => void;
  onBack: () => void;
};

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
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const cpfDigits = data.entityType === "pj" ? "" : data.cpf.replace(/\D/g, "");
  const docDigits = data.entityType === "pj" ? data.cnpj.replace(/\D/g, "") : cpfDigits;

  const requestScore = useMutation(api.contracts.useCases.requestCreditScore);
  const [requestedFor, setRequestedFor] = React.useState<string | null>(null);

  // No plan is pre-selected; Step 2's Next stays blocked until the broker picks
  // one. "plus" adds the prestamista premium to the monthly fee (priceContract).
  const selectedPlan = data.plan;

  const scoreResult = useQuery(
    api.contracts.useCases.getCachedCreditScore,
    agencyId && docDigits ? { agencyId, document: docDigits } : "skip",
  );

  const tenantLookup = useQuery(
    api.tenants.useCases.lookupTenantByTaxId,
    agencyId && docDigits ? { agencyId, taxId: docDigits } : "skip",
  );

  const triggerScoreRequest = React.useEffectEvent(
    (doc: string, agId: NonNullable<typeof agencyId>) => {
      requestScore({ agencyId: agId, document: doc })
        .then((result) => {
          if (result.status === "fetching" || result.status === "cached") setRequestedFor(doc);
        })
        .catch(() => {});
    },
  );

  React.useEffect(() => {
    if (!agencyId || !docDigits) return;
    triggerScoreRequest(docDigits, agencyId);
  }, [docDigits, agencyId]);

  const applyScore = React.useEffectEvent(
    (result: { score: number; tier: ScoreTier } | null | undefined) => {
      onChange({ score: result?.score ?? null, scoreTier: result?.tier ?? null });
    },
  );

  const applyTenantLookup = React.useEffectEvent(
    (lookup: { fullName: string; email: string } | null | undefined) => {
      if (!lookup) return;
      const patch: Partial<DraftWizardData> = {};
      if (!data.fullName) patch.fullName = lookup.fullName;
      if (!data.email) patch.email = lookup.email;
      if (Object.keys(patch).length > 0) onChange(patch);
    },
  );

  React.useEffect(() => {
    if (scoreResult !== undefined) applyScore(scoreResult);
  }, [scoreResult]);

  React.useEffect(() => {
    applyTenantLookup(tenantLookup);
  }, [tenantLookup]);

  const score = scoreResult?.score ?? null;
  const scoreTier = scoreResult?.tier ?? null;
  const priceableTier = scoreTier && scoreTier !== "negado" ? scoreTier : null;

  // Loading while: no document entered, Convex query loading (undefined),
  // or action in flight (requested for this doc but no cached result yet).
  const isLoading =
    !docDigits || scoreResult === undefined || (requestedFor === docDigits && scoreResult === null);
  const isNegado = score !== null && score < 400;

  const preview =
    priceableTier && data.rentCents > 0 && data.plan
      ? priceContract({
          rentCents: data.rentCents,
          condoCents: data.condoCents,
          otherFeesCents: data.otherFeesCents,
          tier: priceableTier,
          plan: data.plan,
        })
      : null;
  const commission = preview ? splitCommission(preview) : null;

  const tierLabel: Record<ScoreTier, string> = {
    bom: t("tenant.scoreBom"),
    regular: t("tenant.scoreRegular"),
    ruim: t("tenant.scoreRuim"),
    negado: t("tenant.scoreNegado"),
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Score result */}
      <section
        className={cn(
          "flex flex-col gap-3 rounded-lg border-2 p-4 transition-colors md:p-6",
          scoreTier ? TIER_CARD_STYLE[scoreTier] : "border-border",
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
                <span className="font-mono text-3xl font-bold">{score}</span>
                {scoreTier && (
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-sm font-medium",
                      TIER_STYLE[scoreTier],
                    )}
                  >
                    {tierLabel[scoreTier]}
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
                  {formatBRLCents(data.rentCents)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Coverage plans — two selectable cards; "+" carries a subtle premium accent */}
      {!isLoading && !isNegado && priceableTier && (
        <div
          role="radiogroup"
          aria-label={t("coverage.planLabel")}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <CoveragePlanCard
            planName={t("coverage.planBasic")}
            feeRatePct={DEFAULT_PRICING_TABLE.tierRate[priceableTier] * 100}
            selected={selectedPlan === CONTRACT_PLAN.BASIC}
            onSelect={() => onChange({ plan: CONTRACT_PLAN.BASIC })}
          />
          <CoveragePlanCard
            planName={t("coverage.planPlus")}
            feeRatePct={DEFAULT_PRICING_TABLE.tierRate[priceableTier] * 100}
            selected={selectedPlan === CONTRACT_PLAN.PLUS}
            emphasized
            includesPrestamista
            onSelect={() => onChange({ plan: CONTRACT_PLAN.PLUS })}
          />
        </div>
      )}

      {/* Summary block */}
      {!isLoading && !isNegado && (
        <section className="flex flex-col gap-3 rounded-lg border p-4 md:p-6">
          <h2 className="text-base font-semibold">{t("coverage.summary.heading")}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryRow
              label={t("coverage.summary.exitCost")}
              value={
                data.rentCents > 0
                  ? formatBRLCents(DEFAULT_PRICING_TABLE.exitCostMultiplier * data.rentCents)
                  : null
              }
            />
            <SummaryRow
              label={t("coverage.summary.fee")}
              value={preview ? formatBRLCents(preview.feeCents) : null}
            />
            <SummaryRow
              label={t("coverage.summary.commission")}
              value={commission ? formatBRLCents(commission.commissionCents) : null}
            />
            <SummaryRow
              label={t("coverage.summary.guarantee")}
              value={commission ? formatBRLCents(commission.totalCents) : null}
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
          <Button onClick={onNext} disabled={isLoading || score === null || !data.plan}>
            {t("nav.nextStep3")}
          </Button>
        )}
      </div>
    </div>
  );
}

function CoveragePlanCard({
  planName,
  feeRatePct,
  selected,
  onSelect,
  emphasized = false,
  includesPrestamista = false,
}: {
  planName: string;
  feeRatePct: number;
  selected: boolean;
  onSelect: () => void;
  emphasized?: boolean;
  includesPrestamista?: boolean;
}) {
  const t = useTranslations("contractNew.coverage");
  return (
    <div
      role="radio"
      aria-checked={selected}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        // Ignore keys bubbling from inner controls (e.g. the info button).
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-4 rounded-lg border p-4 text-left transition-all duration-200 md:p-6",
        "hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-md",
        "focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
        // Subtle premium accent for the "+" plan, present even when unselected.
        emphasized && !selected && "border-primary/40 bg-primary/[0.03] shadow-sm",
        selected && "border-primary ring-primary/60 bg-primary/[0.04] ring-1",
      )}
    >
      {/* Radio indicator — reinforces that the card is a choice. */}
      <span
        aria-hidden
        className={cn(
          "absolute top-4 right-4 flex size-5 items-center justify-center rounded-full border-2 transition-colors",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-muted-foreground/30 group-hover:border-primary/50",
        )}
      >
        {selected && <CheckIcon className="size-3" strokeWidth={3} />}
      </span>

      <div className="flex flex-col gap-0.5 pr-8">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("planLabel")}
        </span>
        <h2 className="text-base font-semibold uppercase">{planName}</h2>
      </div>

      <div className="flex flex-col gap-3">
        <div className="bg-muted/50 flex flex-col gap-1 rounded-md p-3">
          <span className="text-sm font-semibold">{t("rentCoverageFull")}</span>
          <span className="text-muted-foreground text-xs">{t("rentCoverageIncludes")}</span>
        </div>
        <PlanRow label={t("exitCoverage")} value={`${DEFAULT_PRICING_TABLE.exitCostMultiplier}x`} />
        {includesPrestamista && (
          <div className="bg-primary/[0.06] flex items-center justify-between gap-2 rounded-md p-3">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {t("prestamistaLabel")}
              <PrestamistaInfo />
            </span>
            <span className="text-primary text-sm font-semibold">
              +{formatBRLCents(DEFAULT_PRICING_TABLE.prestamistaPremiumCents)}
            </span>
          </div>
        )}
        <PlanRow label={t("feeRate")} value={`${feeRatePct.toFixed(0)}%`} emphasized />
      </div>
    </div>
  );
}

function PrestamistaInfo() {
  const t = useTranslations("contractNew.coverage");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("prestamistaInfoAria")}
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:border-foreground/50 hover:text-foreground focus-visible:ring-ring flex size-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px] leading-none font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-56">{t("prestamistaTooltip")}</TooltipContent>
    </Tooltip>
  );
}

function PlanRow({
  label,
  value,
  emphasized = false,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "bg-muted/50 flex flex-col gap-1 rounded-md p-3",
        emphasized && "items-end text-right",
      )}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("font-mono font-semibold", emphasized ? "text-base" : "text-sm")}>
        {value}
      </span>
    </div>
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
