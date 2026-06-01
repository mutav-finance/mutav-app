"use client";

import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { Link } from "@/i18n/navigation";
import { CheckCircle2Icon } from "lucide-react";

type Props = {
  publicId: string;
  onReset: () => void;
};

export function WizardStep5({ publicId, onReset }: Props) {
  const t = useTranslations("contractNew");

  return (
    <div className="flex flex-col items-center py-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-lg border p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <CheckCircle2Icon className="text-primary h-12 w-12" />
          <h2 className="text-base font-semibold tracking-widest">{t("success.heading")}</h2>
          <p className="text-base-sm font-medium">{t("success.subtitle")}</p>
          <p className="font-mono text-sm font-medium">{publicId}</p>
        </div>

        <p className="text-muted-foreground text-sm">{t("success.description")}</p>

        <div className="flex w-full flex-col gap-2 sm:flex-row">
          <Button asChild className="flex-1">
            <Link href={`/contracts/${publicId}`}>{t("success.viewContract")}</Link>
          </Button>
          <Button variant="outline" className="flex-1" onClick={onReset}>
            {t("success.createAnother")}
          </Button>
        </div>
      </div>
    </div>
  );
}
