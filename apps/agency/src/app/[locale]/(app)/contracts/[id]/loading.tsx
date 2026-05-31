import { getTranslations } from "next-intl/server";
import { PageContent } from "@/components/page/page-content";
import { PageShell } from "@/components/page/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default async function Loading() {
  const tLoading = await getTranslations("contractDetails.loading");

  return (
    <PageShell>
      <PageContent variant="narrow" role="status" aria-live="polite" aria-label={tLoading("label")}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-96 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-56 w-full" />
      </PageContent>
    </PageShell>
  );
}
