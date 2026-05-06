"use client";

import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ContractActionsMenu() {
  const t = useTranslations("contractDetails.rentalData");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          {t("actions")}
          <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled>{t("actionEdit")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("actionDuplicate")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("actionArchive")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
