"use client";

import { Building2, Check, Clock, User, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { LogoMark } from "@mutav/brand/logo-mark";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { cn } from "@mutav/ui/cn";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { PendingInvites } from "@/components/onboarding/pending-invites";
import {
  useWelcomeScreen,
  type WelcomeScreenAgencyType,
} from "@/components/onboarding/use-welcome-screen";

const AGENCY_TYPE_ICON: Record<WelcomeScreenAgencyType, LucideIcon> = {
  autonomo: User,
  empresa: Building2,
};

// The review SLA is stated once, under the CTA (ctaNoteReview).
const PROOF_POINT_KEYS = ["onchainReserve", "noGuarantor"] as const;

const AGENCY_TYPE_HEADING_ID = "welcome-agency-type-heading";

export function WelcomeScreen() {
  const t = useTranslations("onboarding.welcome");
  const vm = useWelcomeScreen();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 md:py-16 lg:px-8">
      <PendingInvites />

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-16">
        {/* Pitch */}
        <section className="relative flex flex-col gap-8 overflow-hidden lg:py-6">
          <LogoMark className="text-text pointer-events-none absolute -right-8 -bottom-6 hidden h-64 w-auto opacity-[0.04] lg:block" />

          <Eyebrow as="p" size="2xs" className="relative flex items-center gap-3">
            <span className="bg-accent block h-3 w-px shrink-0" aria-hidden />
            {t("tag")}
          </Eyebrow>

          <h1 className="font-display text-text relative text-4xl leading-[1.05] font-bold tracking-[-0.03em] text-balance md:text-5xl">
            <span className="block">{t("title")}</span>
            <span className="text-text-2 block">{t("titleLine2")}</span>
          </h1>

          <ul className="relative flex max-w-md flex-col gap-3">
            {PROOF_POINT_KEYS.map((key) => (
              <li key={key} className="text-text-2 text-base-sm flex items-start gap-3">
                <Check className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t(`proofPoints.${key}`)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Agency type choice */}
        <section aria-labelledby={AGENCY_TYPE_HEADING_ID} className="flex flex-col gap-6">
          <h2
            id={AGENCY_TYPE_HEADING_ID}
            className="text-text text-lg font-semibold tracking-tight"
          >
            {t("typeQuestion")}
          </h2>

          <ToggleGroup
            type="single"
            orientation="vertical"
            value={vm.selectedType ?? ""}
            onValueChange={vm.selectType}
            aria-labelledby={AGENCY_TYPE_HEADING_ID}
            className="flex w-full flex-col gap-3"
          >
            {vm.agencyTypes.map((type) => {
              const Icon = AGENCY_TYPE_ICON[type];
              const checked = vm.selectedType === type;
              return (
                <ToggleGroupItem
                  key={type}
                  value={type}
                  className={cn(
                    "border-border bg-surface flex h-auto w-full items-start justify-start gap-4 rounded-none border px-4 py-4 text-left whitespace-normal transition-colors",
                    "hover:border-text-3 hover:bg-surface data-[state=on]:border-accent data-[state=on]:bg-accent/5",
                    "focus-visible:ring-ring focus-visible:ring-offset-canvas focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      checked ? "text-accent" : "text-text-2",
                    )}
                    aria-hidden
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-text font-medium">{t(`${type}.title`)}</span>
                    <span className="text-text-2 text-sm">{t(`${type}.description`)}</span>
                  </span>
                  <span
                    className={cn(
                      "mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border",
                      checked ? "border-accent" : "border-text-3",
                    )}
                    aria-hidden
                  >
                    {checked && <span className="bg-accent size-2 rounded-full" />}
                  </span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>

          {vm.checklist.length > 0 && (
            <div className="border-border flex flex-col gap-3 border-t pt-6">
              <Eyebrow as="h3" size="2xs">
                {t("checklistTitle")}
              </Eyebrow>
              <ul className="flex flex-col gap-2">
                {vm.checklist.map((item) => (
                  <li key={item.label} className="flex items-start gap-3 text-sm">
                    <Check className="text-accent mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="text-text">
                      {item.label}
                      {item.note && <span className="text-text-3"> — {item.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {vm.showPartnerWarning && (
            <div className="border-accent/30 bg-accent/5 border-l-2 px-4 py-3">
              <p className="text-text text-sm leading-relaxed">
                <span className="font-medium">{t("warningTitle")}</span> {t("warningBody")}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {vm.ctaHref ? (
              <Button asChild size="lg" className="w-full">
                <Link href={vm.ctaHref}>{t("ctaButton")}</Link>
              </Button>
            ) : (
              <Button disabled size="lg" className="w-full">
                {t("ctaButton")}
              </Button>
            )}
            <p className="text-text-3 flex items-center justify-center gap-2 text-xs">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              {t("ctaNoteReview")}
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
