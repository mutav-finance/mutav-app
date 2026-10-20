"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Input } from "@mutav/ui/input";
import { Label } from "@mutav/ui/label";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";

/** Staff reach one guarantee by the ID the agency quotes; there is no cross-agency list yet. */
export function GuaranteeLookup() {
  const t = useTranslations("guarantees");
  const router = useRouter();
  const [publicId, setPublicId] = React.useState("");
  const trimmed = publicId.trim();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed) return;
    router.push(`/guarantees/${encodeURIComponent(trimmed)}`);
  }

  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="narrow">
        <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:max-w-sm">
          <Label htmlFor="guarantee-public-id">{t("lookup.label")}</Label>
          <div className="flex gap-2">
            <Input
              id="guarantee-public-id"
              value={publicId}
              onChange={(event) => setPublicId(event.target.value)}
              placeholder={t("lookup.placeholder")}
              autoComplete="off"
            />
            <Button type="submit" disabled={!trimmed}>
              {t("lookup.submit")}
            </Button>
          </div>
        </form>
      </PageContent>
    </PageShell>
  );
}
