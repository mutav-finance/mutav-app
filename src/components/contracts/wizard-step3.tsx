"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useRouter } from "@/i18n/navigation";
import { calcFeePreview, formatBRLCentsDisplay, type WizardData } from "@/lib/contracts/wizard";
import type { RentMultiplier, ExitCostMultiplier } from "@/lib/contracts/wizard";

type Props = {
  data: WizardData;
  agencyId: Id<"agencies">;
  onBack: () => void;
};

export function WizardStep3({ data, agencyId, onBack }: Props) {
  const t = useTranslations("contractNew");
  const router = useRouter();
  const createContract = useMutation(api.contracts.useCases.create);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const preview =
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

  const totalRentCents = data.rentCents + data.condoCents + data.otherFeesCents;

  const handleSubmit = async () => {
    if (
      !data.propertyKind ||
      !data.rentMultiplier ||
      !data.exitCostMultiplier ||
      data.score === null
    ) {
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createContract({
        agencyId,
        property: {
          cep: data.cep.replace(/\D/g, ""),
          streetAndNumber: data.streetAndNumber,
          neighborhood: data.neighborhood,
          cityUF: data.cityUF,
        },
        optional: {
          complement: data.complement,
          tag: "",
          description: "",
        },
        propertyKind: data.propertyKind,
        rentCents: data.rentCents,
        condoCents: data.condoCents,
        otherFeesCents: data.otherFeesCents,
        rentMultiplier: data.rentMultiplier as RentMultiplier,
        exitCostMultiplier: data.exitCostMultiplier as ExitCostMultiplier,
        tenant: {
          fullName: data.fullName,
          cpf: data.cpf,
          birthDate: data.birthDate,
          email: data.email,
          phone: data.phone,
          score: data.score,
        },
      });

      router.push(`/contracts/${result.publicId}`);
    } catch {
      toast.error(t("review.errorToast"));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border p-4 md:p-6">
        <h2 className="text-base font-semibold">{t("review.heading")}</h2>

        <ReviewGroup title={t("review.propertySection")}>
          <ReviewRow
            label={t("property.kindLabel")}
            value={data.propertyKind === "residencial" ? t("property.residencial") : t("property.comercial")}
          />
          <ReviewRow label={t("property.cep")} value={data.cep} />
          <ReviewRow label={t("property.streetAndNumber")} value={data.streetAndNumber} />
          <ReviewRow label={t("property.neighborhood")} value={data.neighborhood} />
          <ReviewRow label={t("property.cityUF")} value={data.cityUF} />
          {data.complement && (
            <ReviewRow label={t("property.complement")} value={data.complement} />
          )}
        </ReviewGroup>

        <Separator />

        <ReviewGroup title={t("review.rentSection")}>
          <ReviewRow label={t("rent.rent")} value={formatBRLCentsDisplay(data.rentCents)} />
          {data.condoCents > 0 && (
            <ReviewRow label={t("rent.condo")} value={formatBRLCentsDisplay(data.condoCents)} />
          )}
          {data.otherFeesCents > 0 && (
            <ReviewRow
              label={t("rent.otherFees")}
              value={formatBRLCentsDisplay(data.otherFeesCents)}
            />
          )}
          <ReviewRow
            label={t("rent.total")}
            value={formatBRLCentsDisplay(totalRentCents)}
            highlight
          />
        </ReviewGroup>

        <Separator />

        <ReviewGroup title={t("review.tenantSection")}>
          <ReviewRow label={t("tenant.fullName")} value={data.fullName} />
          <ReviewRow label={t("tenant.cpf")} value={data.cpf} />
          <ReviewRow label={t("tenant.birthDate")} value={data.birthDate} />
          <ReviewRow label={t("tenant.email")} value={data.email} />
          <ReviewRow label={t("tenant.phone")} value={data.phone} />
          {data.score !== null && data.scoreTier !== null && (
            <ReviewRow
              label={t("review.score")}
              value={`${data.score} (${data.scoreTier})`}
            />
          )}
        </ReviewGroup>

        <Separator />

        <ReviewGroup title={t("review.coverageSection")}>
          <ReviewRow label={t("coverage.rentMultiplierLabel")} value={data.rentMultiplier} />
          <ReviewRow label={t("coverage.exitCostLabel")} value={data.exitCostMultiplier} />
        </ReviewGroup>

        {preview && (
          <>
            <Separator />
            <ReviewGroup title={t("review.valuesSection")}>
              <ReviewRow
                label={t("coverage.preview.fee")}
                value={formatBRLCentsDisplay(preview.feeCents)}
              />
              <ReviewRow
                label={t("coverage.preview.activationFee")}
                value={formatBRLCentsDisplay(preview.oneTimeActivationFeeCents)}
              />
              <ReviewRow
                label={t("coverage.preview.guarantee")}
                value={formatBRLCentsDisplay(preview.availableGuaranteeCents)}
                highlight
              />
            </ReviewGroup>
          </>
        )}
      </section>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
          {t("nav.back")}
        </Button>
        <Button onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? t("review.submitting") : t("review.submit")}
        </Button>
      </div>
    </div>
  );
}

function ReviewGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
        {title}
      </p>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={highlight ? "font-mono font-semibold" : "text-sm"}>{value}</span>
    </div>
  );
}
