"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type EtherfuseOnboardingStatus =
  | "not_started"
  | "pending"
  | "approved"
  | "rejected"
  | "update_required";

type MethodKind = "boleto" | "stellar" | "pix" | "pix_anchor";

type MethodSelectorProps = {
  agencyEtherfuseStatus: EtherfuseOnboardingStatus | null;
  currentMethodKind: MethodKind | null;
  onSelectPixAnchor: () => Promise<void> | void;
};

export function MethodSelector({
  agencyEtherfuseStatus,
  currentMethodKind,
  onSelectPixAnchor,
}: MethodSelectorProps) {
  const t = useTranslations("paymentDetails");
  const tCard = useTranslations("paymentDetails.methodCard");

  const pixAnchorEnabled = agencyEtherfuseStatus === "approved";
  const [isSelecting, setIsSelecting] = React.useState(false);

  const handlePixAnchor = async () => {
    if (isSelecting) return;
    setIsSelecting(true);
    try {
      await onSelectPixAnchor();
    } finally {
      setIsSelecting(false);
    }
  };

  const isCurrent = (kind: MethodKind) => currentMethodKind === kind;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={isCurrent("boleto") ? "default" : "outline"}
        disabled
        aria-pressed={isCurrent("boleto")}
      >
        {t("method.boleto")}
      </Button>
      <Button
        size="sm"
        variant={isCurrent("pix") ? "default" : "outline"}
        disabled
        aria-pressed={isCurrent("pix")}
      >
        {t("method.pix")}
      </Button>
      {pixAnchorEnabled ? (
        <Button
          size="sm"
          variant={isCurrent("pix_anchor") ? "default" : "outline"}
          onClick={handlePixAnchor}
          disabled={isSelecting}
          aria-pressed={isCurrent("pix_anchor")}
          className={cn(isSelecting && "opacity-70")}
        >
          {t("method.pix_anchor")}
        </Button>
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex">
                <Button
                  size="sm"
                  variant="outline"
                  disabled
                  aria-disabled
                  aria-pressed={isCurrent("pix_anchor")}
                >
                  {t("method.pix_anchor")}
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>{tCard("pixAnchorNotEligible")}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
