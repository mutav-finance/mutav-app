import { getTranslations } from "next-intl/server";

/**
 * "Coming soon" placeholder for the A1–A6 admin pillars whose routes are wired
 * in the sidebar but not yet built — so a nav click renders this instead of a
 * 404. Each pillar's page is a one-liner that passes its `nav.main` title key.
 */
type PillarKey = "agencies" | "compliance" | "defaults" | "treasury" | "observability" | "nav";

export async function PillarPlaceholder({ titleKey }: { titleKey: PillarKey }) {
  const tNav = await getTranslations("nav.main");
  const t = await getTranslations("adminShell.placeholder");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-text-2 mb-4 font-mono text-xs tracking-widest uppercase">MUTAV</p>
      <h1 className="text-text mb-3 text-2xl font-semibold tracking-tight">{tNav(titleKey)}</h1>
      <p className="text-text-2 max-w-md text-sm">{t("pillarPending")}</p>
    </div>
  );
}
