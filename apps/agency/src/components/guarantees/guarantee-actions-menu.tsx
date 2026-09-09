"use client";

import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mutav/ui/dropdown-menu";

export function GuaranteeActionsMenu() {
  const t = useTranslations("guaranteeDetails.actions");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline-primary" size="sm">
          {t("trigger")}
          <ChevronDownIcon data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <Eyebrow as={DropdownMenuLabel} className="font-medium">
          {t("disabledHint")}
        </Eyebrow>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{t("edit")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("duplicate")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("archive")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
