"use client";

import { useTranslations } from "next-intl";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { useResubmitButton } from "@/components/onboarding/use-resubmit-button";

export function ResubmitButton({ agencyId }: { agencyId: AgencyId }) {
  const t = useTranslations("onboarding.rejected");
  const vm = useResubmitButton({ agencyId });

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={vm.handleResubmit} disabled={vm.isPending}>
        {vm.isPending ? t("resubmitting") : t("resubmitButton")}
      </Button>
      {vm.errorMessage && (
        <p role="alert" className="text-error text-sm">
          {vm.errorMessage}
        </p>
      )}
    </div>
  );
}
