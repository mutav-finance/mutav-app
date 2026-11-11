"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";

/**
 * A figure's definition, one hover, focus or tap away instead of a caption under it.
 * Radix tooltips ignore taps by design (they close on pointer-down and click), so the
 * open state is ours: a tap toggles it, and hover, focus and outside taps still work
 * through onOpenChange.
 */
export function InfoHint({ label, hint }: { label: string; hint: string }) {
  const t = useTranslations("transparency");
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("hintAriaLabel", { label })}
          className="text-muted-foreground hover:text-foreground -my-1 size-5"
          // preventDefault skips Radix's own close handlers for these two events.
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            setOpen((o) => !o);
          }}
        >
          <InfoIcon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}
