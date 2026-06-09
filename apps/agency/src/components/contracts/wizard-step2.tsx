"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Button } from "@mutav/ui/button";
import { Link } from "@mutav/i18n/navigation";
import { Skeleton } from "@mutav/ui/skeleton";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/providers/workspace";
import { formatBRLCentsDisplay, type WizardData } from "@/lib/contracts/wizard";
import type { ScoreTier } from "@convex/contracts/domain";
import { splitCommission } from "@/lib/pricing/commission";
import { priceContract } from "@/lib/pricing/contract";
import { RENT_COVERAGE_MONTHS, EXIT_COVERAGE_MONTHS, SCORE_TIER_RATE } from "@/lib/pricing/tiers";

type Props = {
  data: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
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

const TIER_FEE_RATE: Record<Exclude<ScoreTier, "negado">, number> = {
  bom: SCORE_TIER_RATE.high,
  regular: SCORE_TIER_RATE.medium,
  ruim: SCORE_TIER_RATE.low,
};

export function WizardStep2({ data, onChange, onNext, onBack }: Props) {
  const t = useTranslations("contractNew");
  const { selectedAgency } = useWorkspace();
  const agencyId = selectedAgency?._id;

  const cpfDigits = data.entityType === "pj" ? "" : data.cpf.replace(/\D/g, "");
  const docDigits = data.entityType === "pj" ? data.cnpj.replace(/\D/g, "") : cpfDigits;

  const requestScore = useMutation(api.contracts.useCases.requestCreditScore);
  const [requestedFor, setRequestedFor] = React.useState<string | null>(null);

  const scoreResult = useQuery(
    api.contracts.useCases.getCachedCreditScore,
    agencyId && docDigits ? { agencyId, document: docDigits } : "skip",
  );

  const tenantLookup = useQuery(
    api.contracts.useCases.lookupTenantByCpf,
    agencyId && cpfDigits ? { agencyId, cpf: cpfDigits } : "skip",
  );

  const triggerScoreRequest = React.useEffectEvent(
    (doc: string, agId: NonNullable<typeof agencyId>) => {
      requestScore({ agencyId: agId, document: doc })
        .then((result) => {
          if (result.status !== "invalid") setRequestedFor(doc);
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
      const patch: Partial<WizardData> = {};
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

  // Loading while: no document entered, Convex query loading (undefined),
  // or action in flight (requested for this doc but no cached result yet).
  const isLoading =
    !docDigits || scoreResult === undefined || (requestedFor === docDigits && scoreResult === null);
  const isNegado = score !== null && score < 400;

  const preview =
    !isNegado && data.rentCents > 0 && score !== null
      ? priceContract({
          rentCents: data.rentCents,
          condoCents: data.condoCents,
          otherFeesCents: data.otherFeesCents,
          score,
        })
      : null;
  const commission = preview ? splitCommission(preview.feeCents) : null;

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
                  {formatBRLCentsDisplay(data.rentCents)}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Fixed plan + pricing — only when approved and score loaded */}
      {!isLoading && !isNegado && (
        <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
          <h2 className="text-base font-semibold">{t("coverage.heading")}</h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PlanRow label={t("coverage.rentCoverage")} value={`${RENT_COVERAGE_MONTHS}x`} />
            <PlanRow label={t("coverage.exitCoverage")} value={`${EXIT_COVERAGE_MONTHS}x`} />
            {scoreTier && scoreTier !== "negado" && (
              <PlanRow
                label={t("coverage.feeRate")}
                value={`${(TIER_FEE_RATE[scoreTier] * 100).toFixed(0)}%`}
              />
            )}
          </div>
        </section>
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
                  ? formatBRLCentsDisplay(EXIT_COVERAGE_MONTHS * data.rentCents)
                  : null
              }
            />
            <SummaryRow
              label={t("coverage.summary.fee")}
              value={preview ? formatBRLCentsDisplay(preview.feeCents) : null}
            />
            <SummaryRow
              label={t("coverage.summary.commission")}
              value={commission ? formatBRLCentsDisplay(commission.commissionCents) : null}
            />
            <SummaryRow
              label={t("coverage.summary.guarantee")}
              value={commission ? formatBRLCentsDisplay(commission.totalCents) : null}
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
          <Button onClick={onNext} disabled={isLoading || score === null}>
            {t("nav.nextStep3")}
          </Button>
        )}
      </div>
    </div>
  );
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted/50 flex flex-col gap-1 rounded-md p-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-sm font-semibold">{value}</span>
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
