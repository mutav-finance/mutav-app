import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { PaymentDetailsPage } from "@/components/payments/payment-details-page";
import { getAuthToken } from "@/lib/auth-token";

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const token = await getAuthToken();
  const preloaded = await preloadQuery(
    api.payments.useCases.getByPublicId,
    { publicId: id },
    token ? { token } : undefined,
  );
  const payment = preloadedQueryResult(preloaded);
  if (!payment) {
    notFound();
  }
  return <PaymentDetailsPage preloaded={preloaded} />;
}
