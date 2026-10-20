"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Mono } from "@mutav/ui/mono";
import { StatusTag, type Tone } from "@mutav/ui/guarantee-state-tag";
import { StepIndicator } from "@mutav/ui/step-indicator";
import { formatDateBR } from "@mutav/i18n/brazil";
import type { ReviewStatus } from "@convex/guarantees/review";
import type { Guarantee } from "@/lib/guarantees/types";
import { ACTIVE_STEP, REVIEW_STEPS } from "@/lib/guarantees/review";
import { useGuaranteeReviewCard } from "./use-guarantee-review-card";

const REVIEW_TONE: Record<ReviewStatus | typeof ACTIVE_STEP, Tone> = {
  editing: "neutral",
  analysis_requested: "expiring",
  accepted: "success",
  awaiting_signature: "success",
  signed: "success",
  active: "success",
  refused: "error",
};

export function GuaranteeReviewCard({ guarantee }: { guarantee: Guarantee }) {
  const t = useTranslations("guaranteeDetails.review");
  const format = useFormatter();
  const view = useGuaranteeReviewCard({ guarantee });
  const { review } = view;

  const staffRate =
    view.acceptedRatePercent === null
      ? null
      : format.number(view.acceptedRatePercent / 100, {
          style: "percent",
          maximumFractionDigits: 2,
        });
  const statusLabel =
    view.step === "accepted" && staffRate !== null
      ? t("acceptedAt", { rate: staffRate })
      : t(`status.${view.step}`);

  return (
    <Card>
      <CardHeader className="border-b">
        <Eyebrow as={CardTitle} size="xs" className="font-medium">
          {t("heading")}
        </Eyebrow>
      </CardHeader>
      <CardContent className="grid gap-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusTag tone={REVIEW_TONE[view.step]}>{statusLabel}</StatusTag>
          {review.requestedAt && (
            <span className="text-muted-foreground text-base-sm">
              {t("requestedOn", { date: formatDateBR(review.requestedAt) })}
            </span>
          )}
        </div>

        {view.stepper.refused ? (
          <div className="flex flex-col gap-1">
            <Eyebrow className="font-medium">{t("refusalReason")}</Eyebrow>
            <p className="text-foreground text-base-sm">{review.refusalReason}</p>
            <p className="text-muted-foreground text-base-sm">{t("refusedNextStep")}</p>
          </div>
        ) : (
          <StepIndicator
            current={view.currentStep}
            labels={REVIEW_STEPS.map((step) => t(`steps.${step}`))}
            progressLabel={t("progressLabel")}
            doneSuffix={t("doneSuffix")}
            currentSuffix={t("currentSuffix")}
          />
        )}

        <p className="text-muted-foreground text-base-sm">{t(`description.${view.step}`)}</p>

        <dl className="text-base-sm grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground">{t("scoreLabel")}</dt>
            <dd>
              <Mono className="font-medium">{view.score}</Mono>
              <span className="text-muted-foreground ml-2 text-xs">{t("scoreHint")}</span>
            </dd>
          </div>
          {staffRate !== null && (
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{t("staffRateLabel")}</dt>
              <dd>
                <Mono className="font-medium">{staffRate}</Mono>
              </dd>
            </div>
          )}
        </dl>

        {view.canRequest && (
          <div>
            <Button onClick={view.request} disabled={view.isRequesting}>
              {view.isRequesting ? t("requesting") : t("requestAnalysis")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
