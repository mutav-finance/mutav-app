"use client";

import { usePreloadedQuery, type Preloaded } from "convex/react";
import type { api } from "@convex/_generated/api";
import { PaymentAddressPaidReceipt } from "@/components/payments/flow/payment-address-paid-receipt";

type Props = {
  preloaded: Preloaded<typeof api.payments.useCases.getPublicByPublicId>;
  children: React.ReactNode;
};

/**
 * Client wrapper that watches the public payment via Convex subscription
 * and swaps between the pending panel (`children`) and the inline receipt
 * when state flips to `paid`. RSC tree stays the SSR'd panel until the
 * first server tick after the Horizon-poll mutation lands.
 */
export function PaymentAddressView({ preloaded, children }: Props) {
  const payment = usePreloadedQuery(preloaded);
  if (!payment) return children;
  if (payment.state.kind === "paid") {
    return <PaymentAddressPaidReceipt paidAt={payment.state.paidAt} method={payment.method} />;
  }
  return children;
}
