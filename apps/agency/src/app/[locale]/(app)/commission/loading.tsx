import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Skeleton } from "@mutav/ui/skeleton";

const SKELETON_ROW_COUNT = 5;

export default async function CommissionLoading() {
  const t = await getTranslations("commission");
  return (
    <PageShell aria-busy="true" aria-label={t("loading")}>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <div className="flex flex-col gap-6 px-4 py-4 lg:px-6">
          <Skeleton className="h-8 w-56" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
          <div className="overflow-hidden rounded border">
            <div className="bg-muted h-10" />
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        </div>
      </PageContent>
    </PageShell>
  );
}
