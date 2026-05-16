"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { QrCode } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PixOnrampSheet } from "@/components/payments/pix-onramp-sheet";
import type { Id } from "@convex/_generated/dataModel";

interface PixOnrampButtonProps {
  paymentId: Id<"payments">;
  variant?: "default" | "outline";
}

export function PixOnrampButton({ paymentId, variant = "outline" }: PixOnrampButtonProps) {
  const t = useTranslations("paymentDetails.methodCard.pix");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <QrCode className="size-4" strokeWidth={1.25} />
        {t("button")}
      </Button>
      <PixOnrampSheet open={open} onOpenChange={setOpen} paymentId={paymentId} />
    </>
  );
}
