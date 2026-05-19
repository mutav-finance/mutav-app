"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWelcomeScreen } from "@/components/onboarding/use-welcome-screen";

export function WelcomeScreen() {
  const t = useTranslations("onboarding.welcome");
  const vm = useWelcomeScreen();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 md:py-20 lg:px-0">
      {/* Hero */}
      <div className="mb-12 flex flex-col items-center gap-4 text-center">
        <p className="text-text-3 font-mono text-xs tracking-widest uppercase">{t("tag")}</p>
        <h1 className="text-text text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
          <span className="block">{t("title")}</span>
          <span className="text-text-2 block font-normal">{t("titleLine2")}</span>
        </h1>
        <p className="text-text-2 max-w-xl text-base leading-relaxed">{t("subtitle")}</p>
      </div>

      {/* Aviso sócio majoritário — relevante apenas para empresa */}
      {vm.selectedType === "empresa" && (
        <div className="border-accent/30 bg-accent/5 mb-10 border-l-2 px-4 py-3 text-left">
          <p className="text-text text-sm leading-relaxed">
            <span className="font-medium">{t("warningTitle")}</span> {t("warningBody")}
          </p>
        </div>
      )}

      {/* Seleção de tipo */}
      <div className="mb-8 grid grid-cols-2 gap-3">
        {(["autonomo", "empresa"] as const).map((type) => (
          <button
            key={type}
            type="button"
            aria-pressed={vm.selectedType === type}
            onClick={() => vm.selectType(type)}
            className={cn(
              "cursor-pointer border px-4 py-4 text-sm font-medium transition-colors",
              vm.selectedType === type
                ? "border-accent bg-accent/5 text-accent"
                : "border-text-3 bg-surface text-text hover:border-accent hover:bg-accent/5 hover:text-accent",
            )}
          >
            {type === "autonomo" ? t("autonomo.title") : t("empresa.title")}
          </button>
        ))}
      </div>

      {/* CTA */}
      <div className="flex flex-col items-end gap-3">
        {vm.selectedType ? (
          <Button asChild size="sm" className="px-6">
            <Link href={`/onboarding/wizard?type=${vm.selectedType}`}>{t("ctaButton")}</Link>
          </Button>
        ) : (
          <Button size="sm" className="px-6" disabled>
            {t("ctaButton")}
          </Button>
        )}
        <span className="text-text-3 flex items-center gap-2 text-xs">
          <span aria-hidden>⏱</span>
          {t("ctaNoteReview")}
        </span>
      </div>
    </div>
  );
}
