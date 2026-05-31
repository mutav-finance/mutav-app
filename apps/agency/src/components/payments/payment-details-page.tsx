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
import { PaymentSummaryCard } from "./payment-summary-card";
import { PaymentLineItemsCard } from "./payment-line-items-card";
import { PaymentMethodCard } from "./payment-method-card";

export function PaymentDetailsPage({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.payments.useCases.getByPublicId>;
}) {
  const payment = usePreloadedQuery(preloaded);
  if (!payment) {
    notFound();
  }

  const t = useTranslations("paymentDetails");
  const tNav = useTranslations("nav.main");
  const tState = useTranslations("paymentDetails.state");

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
                  <Link href="/payments">{tNav("payments")}</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>
                  <Mono>#{payment.publicId}</Mono>
                </BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
        title={t("heroTitle", { state: tState(payment.state.kind) })}
      />
      <PageContent variant="narrow">
        <PaymentSummaryCard payment={payment} />
        <PaymentLineItemsCard payment={payment} />
        <PaymentMethodCard payment={payment} />
      </PageContent>
    </PageShell>
  );
}
