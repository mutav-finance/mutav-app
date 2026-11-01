"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { useRouter } from "@mutav/i18n/navigation";

const REOPEN_ERROR_CODES = ["NOT_FOUND", "NOT_OWNER", "NOT_REJECTED"] as const;
type ReopenErrorCode = (typeof REOPEN_ERROR_CODES)[number];

function isReopenErrorCode(code: string): code is ReopenErrorCode {
  return REOPEN_ERROR_CODES.some((known) => known === code);
}

export function useResubmitButton({ agencyId }: { agencyId: AgencyId }) {
  const t = useTranslations("onboarding.rejected");
  const router = useRouter();
  const reopenOnboarding = useMutation(api.agencies.useCases.reopenOnboarding);

  const [isPending, setIsPending] = React.useState(false);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);

  const handleResubmit = React.useCallback(async () => {
    setIsPending(true);
    setErrorCode(null);
    try {
      const result = await reopenOnboarding({ agencyId });
      if (!result.success) {
        setErrorCode(result.error.code);
        setIsPending(false);
        return;
      }
      const target = result.data.agencyType
        ? `/onboarding/agency?type=${result.data.agencyType}`
        : "/onboarding";
      router.push(target);
    } catch {
      setErrorCode("NETWORK_ERROR");
      setIsPending(false);
    }
  }, [agencyId, reopenOnboarding, router]);

  const errorMessage = errorCode
    ? isReopenErrorCode(errorCode)
      ? t(`errors.${errorCode}`)
      : t("errors.unknown")
    : null;

  return { isPending, errorMessage, handleResubmit };
}
