"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PaymentDrawer } from "@/components/payments/payment-drawer";
import type { Id } from "@convex/_generated/dataModel";

interface PaymentButtonProps {
  paymentId: Id<"payments">;
  publicId: string;
  totalCents: number;
  variant?: "default" | "outline";
}

export function PaymentButton({
  paymentId,
  publicId,
  totalCents,
  variant = "default",
}: PaymentButtonProps) {
  const t = useTranslations("paymentDetails.methodCard.pay");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Wallet className="size-4" strokeWidth={1.25} />
        {t("button")}
      </Button>
      <PaymentDrawer
        open={open}
        onOpenChange={setOpen}
        paymentId={paymentId}
        publicId={publicId}
        totalCents={totalCents}
      />
    </>
  );
}
