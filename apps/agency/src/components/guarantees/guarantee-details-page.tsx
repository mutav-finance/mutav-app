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
import { GuaranteeDocumentsCard } from "./guarantee-documents-card";
import { GuaranteeHistoryCard } from "./guarantee-history-card";
import { GuaranteeRentalDataCard } from "./guarantee-rental-data-card";
import { GuaranteeSummaryCard } from "./guarantee-summary-card";
import { GuaranteeTenantCard } from "./guarantee-tenant-card";

export function GuaranteeDetailsPage({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.guarantees.useCases.getByPublicId>;
}) {
  const guarantee = usePreloadedQuery(preloaded);
  const t = useTranslations("guaranteeDetails");
  const tNav = useTranslations("nav.main");
  const tState = useTranslations("guaranteeDetails.state");

  if (guarantee === null) {
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
                  <Mono>#{guarantee.id}</Mono>
                </BreadcrumbPage>
              </BreadcrumbItem>
            </Eyebrow>
          </Breadcrumb>
        }
        title={t("heroTitle", { state: tState(guarantee.status) })}
      />
      <PageContent variant="narrow">
        <GuaranteeSummaryCard guarantee={guarantee} />
        <GuaranteeTenantCard tenant={guarantee.tenant} />
        <GuaranteeRentalDataCard guarantee={guarantee} />
        <GuaranteeDocumentsCard documents={guarantee.documents} />
        <GuaranteeHistoryCard history={guarantee.history} />
      </PageContent>
    </PageShell>
  );
}
