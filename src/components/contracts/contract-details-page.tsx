"use client";

import { useTranslations } from "next-intl";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { notFound } from "next/navigation";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import { PageShell } from "@/components/page/page-shell";
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
  preloaded: Preloaded<typeof api.contracts.useCases.getByPublicId>;
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
    <PageShell>
      <PageHeader
        variant="hero"
        width="narrow"
        breadcrumb={
          <Breadcrumb>
            <BreadcrumbList className="text-2xs font-mono tracking-[0.06em] uppercase">
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
        }
        title={t("heroTitle", { status: tStatus(contract.status) })}
      />
      <PageContent variant="narrow">
        <ContractSummaryCard contract={contract} />
        <ContractTenantCard tenant={contract.tenant} />
        <ContractRentalDataCard contract={contract} />
        <ContractDocumentsCard documents={contract.documents} />
        <ContractHistoryCard history={contract.history} />
        <ContractPromoBanner />
      </PageContent>
    </PageShell>
  );
}
