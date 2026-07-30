"use client";

import { useTranslations } from "next-intl";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Button } from "@mutav/ui/button";

export default function StaffError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("staff");
  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} />
      <PageContent variant="narrow">
        <p className="text-muted-foreground text-base-sm">{t("errors.unexpected")}</p>
        <Button size="sm" variant="outline" onClick={reset} className="mt-3 w-fit">
          {t("actions.cancel")}
        </Button>
      </PageContent>
    </PageShell>
  );
}
