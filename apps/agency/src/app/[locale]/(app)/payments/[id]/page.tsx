import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { PaymentDetailsPage } from "@/components/payments/payment-details-page";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const preloaded = await preloadQuery(api.payments.useCases.getByPublicId, { publicId: id });
  const payment = preloadedQueryResult(preloaded);
  if (!payment) {
    notFound();
  }
  return <PaymentDetailsPage preloaded={preloaded} />;
}
