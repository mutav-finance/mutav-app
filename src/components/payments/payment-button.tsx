"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Coins, QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PixPaymentDrawer, StellarPaymentDrawer } from "@/components/payments/payment-drawer";
import type { Id } from "@convex/_generated/dataModel";

interface StellarPaymentButtonProps {
  publicId: string;
  totalCents: number;
  variant?: "default" | "outline";
}

export function StellarPaymentButton({
  publicId,
  totalCents,
  variant = "default",
}: StellarPaymentButtonProps) {
  const t = useTranslations("paymentDetails.methodCard.pay.stellar");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <Coins className="size-4" strokeWidth={1.25} />
        {t("button")}
      </Button>
      <StellarPaymentDrawer
        open={open}
        onOpenChange={setOpen}
        publicId={publicId}
        totalCents={totalCents}
      />
    </>
  );
}

interface PixPaymentButtonProps {
  paymentId: Id<"payments">;
  variant?: "default" | "outline";
}

export function PixPaymentButton({ paymentId, variant = "outline" }: PixPaymentButtonProps) {
  const t = useTranslations("paymentDetails.methodCard.pay.pix");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <QrCode className="size-4" strokeWidth={1.25} />
        {t("button")}
      </Button>
      <PixPaymentDrawer open={open} onOpenChange={setOpen} paymentId={paymentId} />
    </>
  );
}
