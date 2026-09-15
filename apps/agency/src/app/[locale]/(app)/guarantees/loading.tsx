import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Skeleton } from "@mutav/ui/skeleton";

export default async function GuaranteesLoading() {
  const t = await getTranslations("guaranteeList");
  return (
    <PageShell aria-busy="true" aria-label={t("loading")}>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <div className="px-4 lg:px-6">
          <Skeleton className="h-9 w-[420px] max-w-full" />
        </div>
        <div className="px-4 lg:px-6">
          <div className="overflow-hidden rounded-lg border">
            <div className="bg-muted h-10" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      </PageContent>
    </PageShell>
  );
}
