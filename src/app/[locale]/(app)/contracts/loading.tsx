import { getTranslations } from "next-intl/server";
import { Skeleton } from "@/components/ui/skeleton";

export default async function ContractsLoading() {
  const t = await getTranslations("contractList");
  return (
    <div
      className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6"
      aria-busy="true"
      aria-label={t("loading")}
    >
      <header className="flex flex-col gap-1">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-72" />
      </header>
      <Skeleton className="h-9 w-[420px] max-w-full" />
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
  );
}
