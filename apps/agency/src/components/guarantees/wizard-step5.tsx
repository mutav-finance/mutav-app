"use client";

import * as React from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2Icon, SendIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";
import { Button } from "@mutav/ui/button";
import { Link } from "@mutav/i18n/navigation";
import { requestAnalysisErrorKey } from "@/lib/guarantees/review";

type Props = {
  publicId: string;
  agencyId: AgencyId;
  onReset: () => void;
};

/**
 * The wizard ends on a draft, not on a submitted request: the broker sees what
 * was created and asks Mutav for analysis in one deliberate click — or leaves
 * it to adjust first and asks from the guarantee page later.
 */
function useWizardStep5({ publicId, agencyId }: Pick<Props, "publicId" | "agencyId">) {
  const t = useTranslations("guaranteeNew.success");
  const tErrors = useTranslations("guaranteeDetails.review");
  const requestAnalysis = useMutation(api.guarantees.reviewMutations.requestAnalysis);
  const [isRequesting, setIsRequesting] = React.useState(false);
  const [requested, setRequested] = React.useState(false);

  async function request() {
    setIsRequesting(true);
    try {
      const result = await requestAnalysis({ agencyId, publicId });
      if (result.success) {
        setRequested(true);
        toast.success(t("requested"));
      } else {
        toast.error(tErrors(requestAnalysisErrorKey(result.error.code)));
      }
    } catch {
      toast.error(tErrors("errors.UNEXPECTED"));
    } finally {
      setIsRequesting(false);
    }
  }

  return { isRequesting, requested, request };
}

export function WizardStep5({ publicId, agencyId, onReset }: Props) {
  const t = useTranslations("guaranteeNew");
  const view = useWizardStep5({ publicId, agencyId });

  return (
    <div className="flex flex-col items-center py-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg border p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <CheckCircle2Icon className="text-primary h-12 w-12" />
          <h2 className="text-base font-semibold tracking-widest">{t("success.heading")}</h2>
          <p className="text-base-sm font-medium">{t("success.subtitle")}</p>
          <p className="font-mono text-sm font-medium">{publicId}</p>
        </div>

        <p className="text-muted-foreground text-sm">
          {view.requested ? t("success.requestedDescription") : t("success.description")}
        </p>

        {!view.requested && (
          <Button className="w-full" onClick={view.request} disabled={view.isRequesting}>
            <SendIcon data-icon="inline-start" aria-hidden />
            {view.isRequesting ? t("success.requesting") : t("success.requestAnalysis")}
          </Button>
        )}

        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" className="flex-1">
            <Link href={`/guarantees/${publicId}`}>{t("success.viewGuarantee")}</Link>
          </Button>
          <Button variant="outline" className="flex-1" onClick={onReset}>
            {t("success.createAnother")}
          </Button>
        </div>
      </div>
    </div>
  );
}
