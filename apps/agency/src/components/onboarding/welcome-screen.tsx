"use client";

import { useTranslations } from "next-intl";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import { useWelcomeScreen } from "@/components/onboarding/use-welcome-screen";

export function WelcomeScreen() {
  const t = useTranslations("onboarding.welcome");
  const vm = useWelcomeScreen();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 md:py-20 lg:px-0">
      {/* Hero */}
      <div className="mb-12 flex flex-col items-center gap-4 text-center">
        <Eyebrow as="p" tone="subtle" size="xs" className="tracking-widest">
          {t("tag")}
        </Eyebrow>
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
      <ToggleGroup
        type="single"
        value={vm.selectedType ?? ""}
        onValueChange={(v) => {
          if (!v) return;
          vm.selectType(v as "autonomo" | "empresa");
        }}
        variant="outline"
        spacing={3}
        className="mb-8 grid w-full grid-cols-2 *:data-[slot=toggle-group-item]:h-auto *:data-[slot=toggle-group-item]:py-4"
      >
        <ToggleGroupItem value="autonomo">{t("autonomo.title")}</ToggleGroupItem>
        <ToggleGroupItem value="empresa">{t("empresa.title")}</ToggleGroupItem>
      </ToggleGroup>

      {/* CTA */}
      <div className="flex flex-col items-end gap-3">
        {vm.selectedType ? (
          <Button asChild>
            <Link href={`/onboarding/agency?type=${vm.selectedType}`}>{t("ctaButton")}</Link>
          </Button>
        ) : (
          <Button disabled>{t("ctaButton")}</Button>
        )}
        <span className="text-text-3 flex items-center gap-2 text-xs">
          <span aria-hidden>⏱</span>
          {t("ctaNoteReview")}
        </span>
      </div>
    </div>
  );
}
