"use client";

import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ContractActionsMenu() {
  const t = useTranslations("contractDetails.rentalData");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline-primary" size="sm">
          {t("actions")}
          <ChevronDownIcon data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-2xs text-muted-foreground font-mono font-medium tracking-[0.06em] uppercase">
          {t("actionDisabled")}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{t("actionEdit")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("actionDuplicate")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("actionArchive")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
