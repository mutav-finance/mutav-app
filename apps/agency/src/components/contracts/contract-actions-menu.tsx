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
        <Eyebrow as={DropdownMenuLabel} className="font-medium">
          {t("actionDisabled")}
        </Eyebrow>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{t("actionEdit")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("actionDuplicate")}</DropdownMenuItem>
        <DropdownMenuItem disabled>{t("actionArchive")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
