import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";

type ChecklistItem = {
  label: string;
  note?: string;
};

function Checklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-start gap-2.5">
          <span className="bg-accent mt-1.5 size-1.5 shrink-0 rounded-full" aria-hidden />
          <span className="text-text text-sm">
            {item.label}
            {item.note && <span className="text-text-3 ml-1 text-xs">({item.note})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export async function WelcomeScreen() {
  const t = await getTranslations("onboarding.welcome");

  const autonomoItems = t.raw("autonomo.items") as ChecklistItem[];
  const empresaItems = t.raw("empresa.items") as ChecklistItem[];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 md:py-20 lg:px-0">
      {/* Hero */}
      <div className="mb-12 flex flex-col gap-4">
        <p className="text-text-3 font-mono text-xs tracking-widest uppercase">{t("tag")}</p>
        <h1 className="text-text text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
          {t("title")}
        </h1>
        <p className="text-text-2 max-w-xl text-base leading-relaxed">{t("subtitle")}</p>
      </div>

      {/* Aviso sócio majoritário */}
      <div className="border-accent/30 bg-accent/5 mb-10 border-l-2 px-4 py-3">
        <p className="text-text text-sm leading-relaxed">
          <span className="font-medium">{t("warningTitle")}</span> {t("warningBody")}
        </p>
      </div>

      {/* Checklists */}
      <div className="mb-12">
        <p className="text-text-2 mb-5 font-mono text-xs tracking-widest uppercase">
          {t("checklistTitle")}
        </p>
        <div className="border-border bg-border grid grid-cols-1 gap-px border sm:grid-cols-2">
          <div className="bg-surface p-6">
            <p className="text-text mb-4 font-mono text-sm font-medium">{t("autonomo.title")}</p>
            <Checklist items={autonomoItems} />
          </div>
          <div className="bg-surface p-6">
            <p className="text-text mb-4 font-mono text-sm font-medium">{t("empresa.title")}</p>
            <Checklist items={empresaItems} />
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link href="/onboarding/wizard">{t("ctaButton")}</Link>
        </Button>
        <p className="text-text-3 text-xs leading-relaxed">{t("ctaNote")}</p>
      </div>
    </div>
  );
}
