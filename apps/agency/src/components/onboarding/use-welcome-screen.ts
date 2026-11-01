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

const NEXT_KEYS: readonly string[] = ["ArrowDown", "ArrowRight"];
const PREVIOUS_KEYS: readonly string[] = ["ArrowUp", "ArrowLeft"];

/** Arrow-key target inside the radiogroup, wrapping at both ends. */
export function nextAgencyType({
  current,
  key,
}: {
  current: WelcomeScreenAgencyType | null;
  key: string;
}): WelcomeScreenAgencyType | null {
  const step = NEXT_KEYS.includes(key) ? 1 : PREVIOUS_KEYS.includes(key) ? -1 : 0;
  if (step === 0) return null;
  const count = WELCOME_SCREEN_AGENCY_TYPES.length;
  const index =
    current === null ? (step === 1 ? -1 : 0) : WELCOME_SCREEN_AGENCY_TYPES.indexOf(current);
  return WELCOME_SCREEN_AGENCY_TYPES[(index + step + count) % count] ?? null;
}

export function useWelcomeScreen() {
  const t = useTranslations("onboarding.welcome");
  const [selectedType, setSelectedType] = React.useState<WelcomeScreenAgencyType | null>(null);
  const optionRefs = React.useRef(new Map<WelcomeScreenAgencyType, HTMLButtonElement>());

  const selectType = React.useCallback((type: WelcomeScreenAgencyType) => {
    setSelectedType(type);
  }, []);

  const registerOption = React.useCallback(
    (type: WelcomeScreenAgencyType) => (node: HTMLButtonElement | null) => {
      if (node) optionRefs.current.set(type, node);
      else optionRefs.current.delete(type);
    },
    [],
  );

  const handleOptionKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      const target = nextAgencyType({ current: selectedType, key: event.key });
      if (!target) return;
      event.preventDefault();
      setSelectedType(target);
      optionRefs.current.get(target)?.focus();
    },
    [selectedType],
  );

  /** Roving tabindex: the checked card, or the first one before any choice. */
  const isTabStop = (type: WelcomeScreenAgencyType) =>
    selectedType === null ? type === WELCOME_SCREEN_AGENCY_TYPES[0] : selectedType === type;

  const checklist = selectedType ? parseChecklistItems(t.raw(`${selectedType}.items`)) : [];

  return {
    agencyTypes: WELCOME_SCREEN_AGENCY_TYPES,
    selectedType,
    selectType,
    registerOption,
    handleOptionKeyDown,
    isTabStop,
    checklist,
    showPartnerWarning: selectedType === "empresa",
    ctaHref: selectedType ? `/onboarding/agency?type=${selectedType}` : null,
  };
}
