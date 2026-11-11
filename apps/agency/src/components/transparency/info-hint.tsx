"use client";

import { useTranslations } from "next-intl";
import { InfoIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@mutav/ui/tooltip";

/** A figure's definition, one hover or focus away instead of a caption under it. */
export function InfoHint({ label, hint }: { label: string; hint: string }) {
  const t = useTranslations("transparency");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("hintAriaLabel", { label })}
          className="text-muted-foreground hover:text-foreground -my-1 size-5"
        >
          <InfoIcon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{hint}</TooltipContent>
    </Tooltip>
  );
}
