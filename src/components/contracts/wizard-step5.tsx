"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { CheckCircle2Icon } from "lucide-react";

type Props = {
  publicId: string;
  onReset: () => void;
};

export function WizardStep5({ publicId, onReset }: Props) {
  const t = useTranslations("contractNew");

  return (
    <div className="flex flex-col items-center gap-6 py-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <CheckCircle2Icon className="text-primary h-12 w-12" />
        <h2 className="text-xl font-semibold">{t("success.heading")}</h2>
        <p className="text-muted-foreground max-w-sm text-sm">{t("success.message")}</p>
        <p className="font-mono text-sm font-medium">{publicId}</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link href={`/contracts/${publicId}`}>{t("success.viewContract")}</Link>
        </Button>
        <Button variant="outline" onClick={onReset}>
          {t("success.createAnother")}
        </Button>
      </div>
    </div>
  );
}
