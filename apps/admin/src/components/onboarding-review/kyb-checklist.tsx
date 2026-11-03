"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { toast } from "sonner";
import { ExternalLinkIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import { KYB_CHECK_ITEMS } from "@convex/agencies/domain";
import type { KybCheckItem } from "@convex/agencies/domain";
import { Checkbox } from "@mutav/ui/checkbox";
import { Label } from "@mutav/ui/label";
import { kybItemLabelKey, kybLookups, reviewErrorMessageKey } from "./view-model";

type PendingAgency = FunctionReturnType<typeof api.mutavStaff.useCases.listPendingReviews>[number];

export function KybChecklist({ agency }: { agency: PendingAgency }) {
  const t = useTranslations("adminReview");
  const locale = useLocale();
  const setKybCheck = useMutation(api.mutavStaff.useCases.setKybCheck);
  const [pendingItem, setPendingItem] = useState<KybCheckItem | null>(null);

  const checkByItem = new Map(agency.kybChecks.map((check) => [check.item, check]));
  const formatDate = new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" });

  async function toggle(item: KybCheckItem, checked: boolean) {
    setPendingItem(item);
    try {
      const result = await setKybCheck({ agencyId: agency._id, item, checked });
      if (!result.success) toast.error(t(reviewErrorMessageKey(result.error.code)));
    } catch {
      toast.error(t("errors.unexpected"));
    } finally {
      setPendingItem(null);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-foreground text-base-sm mb-1 font-medium">{t("kyb.title")}</legend>
      <p className="text-muted-foreground text-base-sm">{t("kyb.hint")}</p>
      <ul className="flex flex-col gap-3">
        {KYB_CHECK_ITEMS.map((item) => {
          const check = checkByItem.get(item);
          const inputId = `kyb-${agency._id}-${item}`;
          const lookups = kybLookups({ item, agency });
          return (
            <li key={item} className="flex items-start gap-3">
              <Checkbox
                id={inputId}
                checked={check !== undefined}
                disabled={pendingItem !== null}
                onCheckedChange={(value) => toggle(item, value === true)}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor={inputId} className="font-normal">
                  {t(kybItemLabelKey({ item, agencyType: agency.agencyType }))}
                </Label>
                {check && (
                  <p className="text-muted-foreground text-xs">
                    {t("kyb.checkedBy", {
                      name: check.checkedByName ?? t("kyb.unknownReviewer"),
                      date: formatDate.format(new Date(check.checkedAt)),
                    })}
                  </p>
                )}
                {lookups.length > 0 && (
                  <div className="flex flex-wrap gap-3">
                    {lookups.map((lookup) => (
                      <a
                        key={lookup.key}
                        href={lookup.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
                      >
                        {t(`kyb.lookups.${lookup.key}`)}
                        <ExternalLinkIcon className="size-3" aria-hidden />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
