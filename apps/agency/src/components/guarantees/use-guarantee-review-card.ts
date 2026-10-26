"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Guarantee } from "@/lib/guarantees/types";
import {
  bpsToPercent,
  canRequestAnalysis,
  currentReviewStep,
  isWaitingForReserveCapacity,
  requestAnalysisErrorKey,
  reviewStepper,
} from "@/lib/guarantees/review";

/**
 * View model for the review card: derives the stepper and the one action the
 * agency owns in the review (handing the draft to Mutav), and owns that
 * action's in-flight flag and toasts.
 */
export function useGuaranteeReviewCard({ guarantee }: { guarantee: Guarantee }) {
  const t = useTranslations("guaranteeDetails.review");
  const requestAnalysis = useMutation(api.guarantees.reviewMutations.requestAnalysis);
  const [isRequesting, setIsRequesting] = React.useState(false);

  const review = guarantee.review;
  const step = currentReviewStep({ status: guarantee.status, review: review.status });
  const stepper = reviewStepper(step);
  const currentStepIndex = stepper.steps.findIndex((step) => step.state === "current");
  const acceptedRatePercent =
    review.acceptedFeeRateBps === null ? null : bpsToPercent(review.acceptedFeeRateBps);

  async function request() {
    setIsRequesting(true);
    try {
      const result = await requestAnalysis({
        agencyId: guarantee.agencyId,
        publicId: guarantee.id,
      });
      if (result.success) {
        toast.success(t("toastRequested"));
      } else {
        toast.error(t(requestAnalysisErrorKey(result.error.code)));
      }
    } catch {
      toast.error(t("errors.UNEXPECTED"));
    } finally {
      setIsRequesting(false);
    }
  }

  return {
    review,
    step,
    stepper,
    currentStep: currentStepIndex + 1,
    acceptedRatePercent,
    score: guarantee.underwriting.score,
    canRequest: canRequestAnalysis({ status: guarantee.status, review: review.status }),
    waitingForReserveCapacity: isWaitingForReserveCapacity({
      status: guarantee.status,
      review: review.status,
      reserveRefusedAt: review.reserveRefusedAt,
    }),
    isRequesting,
    request,
  };
}
