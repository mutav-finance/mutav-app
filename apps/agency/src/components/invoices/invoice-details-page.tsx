"use client";

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
import { derivedStatus } from "@convex/invoices/domain";
import { utcTodayDate } from "@/lib/invoices/format";
import { InvoiceSummaryCard } from "./invoice-summary-card";
import { InvoiceLineItemsCard } from "./invoice-line-items-card";
import { InvoiceMethodCard } from "./invoice-method-card";

export function InvoiceDetailsPage({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.invoices.useCases.getByPublicId>;
}) {
  const payment = usePreloadedQuery(preloaded);
  if (!payment) {
    notFound();
  }

  const t = useTranslations("invoiceDetails");
  const tNav = useTranslations("nav.main");
  const tState = useTranslations("invoiceDetails.state");

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
                  <Link href="/invoices">{tNav("invoices")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  <Mono>#{payment.publicId}</Mono>
                </BreadcrumbPage>
              </BreadcrumbItem>
            </Eyebrow>
          </Breadcrumb>
        }
        title={t("heroTitle", { state: tState(derivedStatus(payment, utcTodayDate())) })}
      />
      <PageContent variant="narrow">
        <InvoiceSummaryCard payment={payment} />
        <InvoiceLineItemsCard payment={payment} />
        <InvoiceMethodCard payment={payment} />
      </PageContent>
    </PageShell>
  );
}
