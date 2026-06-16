"use client";

import { useTranslations } from "next-intl";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Card, CardContent, CardHeader, CardTitle } from "@mutav/ui/card";
import { Link } from "@mutav/i18n/navigation";

export default function ContractError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("contractDetails.errors");

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
            {error.digest && <Eyebrow as="p">ID · {error.digest}</Eyebrow>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={reset}>{t("retry")}</Button>
              <Button variant="outline-primary" asChild>
                <Link href="/contracts">{t("backToContracts")}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageContent>
    </PageShell>
  );
}
