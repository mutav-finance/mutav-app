"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

export default function ContractError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("contractDetails.errors");

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 md:gap-6">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="font-display text-xl font-bold tracking-tight text-foreground">
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-4">
            <p className="text-base-sm text-muted-foreground">{t("body")}</p>
            {error.digest && (
              <p className="font-mono text-2xs uppercase tracking-[0.06em] text-muted-foreground">
                ID · {error.digest}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={reset}>{t("retry")}</Button>
              <Button
                variant="outline"
                asChild
                className="border-primary text-primary bg-transparent hover:bg-accent-dim hover:text-primary"
              >
                <Link href="/">{t("backToDashboard")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
