"use client";

import { useTranslations } from "next-intl";
import { PageContent } from "@/components/page/page-content";
import { PageShell } from "@/components/page/page-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";

export default function ContractsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("contractList.errors");

  return (
    <PageShell>
      <PageContent variant="narrow">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="font-display text-foreground text-xl font-bold tracking-tight">
              {t("title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 py-4">
            <p className="text-base-sm text-muted-foreground">{t("body")}</p>
            {error.digest && (
              <p className="text-2xs text-muted-foreground font-mono tracking-[0.06em] uppercase">
                ID · {error.digest}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={reset}>{t("retry")}</Button>
              <Button
                variant="outline"
                asChild
                className="border-primary text-primary hover:bg-accent-dim hover:text-primary bg-transparent"
              >
                <Link href="/">{t("backToDashboard")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageContent>
    </PageShell>
  );
}
