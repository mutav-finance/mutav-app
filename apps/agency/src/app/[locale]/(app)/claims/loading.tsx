import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Skeleton } from "@mutav/ui/skeleton";

export default async function ClaimsLoading() {
  const t = await getTranslations("delinquencies");
  return (
    <PageShell aria-busy="true" aria-label={t("heading")}>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <div className="flex flex-col gap-4 px-4 py-4 lg:px-6">
          <Skeleton className="h-9 w-[420px] max-w-full" />
          <div className="overflow-hidden rounded border">
            <div className="bg-muted h-10" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-28" />
              </div>
            ))}
          </div>
        </div>
      </PageContent>
    </PageShell>
  );
}
