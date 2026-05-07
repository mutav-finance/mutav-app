import { getTranslations } from "next-intl/server";
import { preloadQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { ContractListTable } from "@/components/contracts/contract-list-table";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contractList.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function ContractsPage() {
  const t = await getTranslations("contractList");
  const preloaded = await preloadQuery(api.contracts.useCases.list, {
    paginationOpts: { numItems: 50, cursor: null },
  });

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-foreground text-xl font-bold tracking-tight">
          {t("heading")}
        </h1>
        <p className="text-base-sm text-muted-foreground">{t("subheading")}</p>
      </header>
      <ContractListTable preloaded={preloaded} />
    </div>
  );
}
