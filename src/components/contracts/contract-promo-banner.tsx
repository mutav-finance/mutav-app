import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ContractPromoBanner() {
  const t = useTranslations("contractDetails.promo");
  return (
    <Card className="bg-accent-dim">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
            {t("title")}
          </h2>
          <p className="text-base-sm text-foreground/80">{t("body")}</p>
        </div>
        <Button className="self-start">{t("cta")}</Button>
      </CardContent>
    </Card>
  );
}
