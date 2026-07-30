import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Skeleton } from "@mutav/ui/skeleton";

export default async function StaffLoading() {
  const t = await getTranslations("staff");
  return (
    <PageShell>
      <PageHeader variant="section" title={t("title")} subtitle={t("subtitle")} />
      <PageContent variant="full">
        <div className="flex flex-col gap-2 px-4 lg:px-6">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </PageContent>
    </PageShell>
  );
}
