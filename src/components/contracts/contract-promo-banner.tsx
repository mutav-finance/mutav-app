import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ContractPromoBanner() {
  const t = useTranslations("contractDetails.promo");
  return (
    <aside aria-label={t("regionLabel")}>
      <Card className="bg-accent-dim">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-foreground">
              {t("title")}
            </p>
            <p className="text-base-sm text-foreground/80">{t("body")}</p>
          </div>
          <Button className="self-start">{t("cta")}</Button>
        </CardContent>
      </Card>
    </aside>
  );
}
