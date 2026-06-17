import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { InvoiceDetailsPage } from "@/components/invoices/invoice-details-page";
import { getAuthToken } from "@/lib/auth-token";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const token = await getAuthToken();
  const preloaded = await preloadQuery(
    api.invoices.useCases.getByPublicId,
    { publicId: id },
    token ? { token } : undefined,
  );
  const payment = preloadedQueryResult(preloaded);
  if (!payment) {
    notFound();
  }
  return <InvoiceDetailsPage preloaded={preloaded} />;
}
