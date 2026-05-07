"use client";

import { useTranslations } from "next-intl";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { notFound } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Mono } from "@/components/ui/mono";
import { Link } from "@/i18n/navigation";
import type { api } from "@convex/_generated/api";
import { ContractDocumentsCard } from "./contract-documents-card";
import { ContractHistoryCard } from "./contract-history-card";
import { ContractPromoBanner } from "./contract-promo-banner";
import { ContractRentalDataCard } from "./contract-rental-data-card";
import { ContractSummaryCard } from "./contract-summary-card";
import { ContractTenantCard } from "./contract-tenant-card";

export function ContractDetailsPage({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.contracts.getByPublicId>;
}) {
  const contract = usePreloadedQuery(preloaded);
  if (!contract) {
    // Handles the rare case of the contract being deleted between SSR
    // and client hydration. Server rendering already short-circuited via
    // notFound() in page.tsx for the initial null case.
    notFound();
  }

  const t = useTranslations("contractDetails");
  const tNav = useTranslations("nav.main");
  const tStatus = useTranslations("contractDetails.status");

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 md:gap-6">
        <Breadcrumb>
          <BreadcrumbList className="font-mono text-2xs tracking-[0.06em] uppercase">
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">{tNav("dashboard")}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>
                <Mono>#{contract.id}</Mono>
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
          {t("heroTitle", { status: tStatus(contract.status) })}
        </h1>

        <ContractPromoBanner />
        <ContractSummaryCard contract={contract} />
        <ContractRentalDataCard contract={contract} />
        <ContractDocumentsCard documents={contract.documents} />
        <ContractHistoryCard history={contract.history} />
        <ContractTenantCard tenant={contract.tenant} />
      </div>
    </div>
  );
}
