"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

export const WELCOME_SCREEN_AGENCY_TYPES = ["autonomo", "empresa"] as const;

export type WelcomeScreenAgencyType = (typeof WELCOME_SCREEN_AGENCY_TYPES)[number];

export type ChecklistItem = { label: string; note?: string };

function isChecklistItem(value: unknown): value is ChecklistItem {
  if (typeof value !== "object" || value === null) return false;
  if (!("label" in value) || typeof value.label !== "string") return false;
  return !("note" in value) || value.note === undefined || typeof value.note === "string";
}

/**
 * `t.raw` hands back the message array untyped; keep only well-formed rows so
 * a malformed catalog entry drops an item instead of crashing the screen.
 */
export function parseChecklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isChecklistItem);
}

export function isWelcomeScreenAgencyType(value: string): value is WelcomeScreenAgencyType {
  return WELCOME_SCREEN_AGENCY_TYPES.some((type) => type === value);
}

export function useWelcomeScreen() {
  const t = useTranslations("onboarding.welcome");
  const [selectedType, setSelectedType] = React.useState<WelcomeScreenAgencyType | null>(null);

  // The toggle group reports "" when the checked card is clicked again; keep the choice.
  const selectType = React.useCallback((value: string) => {
    if (isWelcomeScreenAgencyType(value)) setSelectedType(value);
  }, []);

  const checklist = selectedType ? parseChecklistItems(t.raw(`${selectedType}.items`)) : [];

  return {
    agencyTypes: WELCOME_SCREEN_AGENCY_TYPES,
    selectedType,
    selectType,
    checklist,
    showPartnerWarning: selectedType === "empresa",
    ctaHref: selectedType ? `/onboarding/agency?type=${selectedType}` : null,
  };
}
