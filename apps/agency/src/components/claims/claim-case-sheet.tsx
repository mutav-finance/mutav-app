"use client";

import { useTranslations } from "next-intl";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@mutav/ui/sheet";
import { ClaimCasePanel } from "@/components/claims/claim-case-panel";

/** The case panel as a side sheet; the same panel the guarantee page opens. */
export function ClaimCaseSheet({
  publicId,
  onClose,
}: {
  publicId: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("claims.sheet");
  return (
    <Sheet open={publicId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {publicId ? <ClaimCasePanel publicId={publicId} onClosed={onClose} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
