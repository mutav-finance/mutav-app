"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { notFound } from "next/navigation";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { Eyebrow } from "@mutav/ui/eyebrow";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@mutav/ui/breadcrumb";
import { Mono } from "@mutav/ui/mono";
import { Link } from "@mutav/i18n/navigation";
import type { api } from "@convex/_generated/api";
import { ContractDocumentsCard } from "./contract-documents-card";
import { ContractHistoryCard } from "./contract-history-card";
import { ContractRentalDataCard } from "./contract-rental-data-card";
import { ContractSummaryCard } from "./contract-summary-card";
import { ContractTenantCard } from "./contract-tenant-card";

export function ContractDetailsPage({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.contracts.useCases.getByPublicId>;
}) {
  const contract = usePreloadedQuery(preloaded);
  const t = useTranslations("contractDetails");
  const tNav = useTranslations("nav.main");
  const tStatus = useTranslations("contractDetails.status");

  if (contract === null) {
    notFound();
  }

  return (
    <PageShell>
      <PageHeader
        variant="hero"
        width="narrow"
        breadcrumb={
          <Breadcrumb>
            <Eyebrow as={BreadcrumbList}>
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
            </Eyebrow>
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
      </PageContent>
    </PageShell>
  );
}
