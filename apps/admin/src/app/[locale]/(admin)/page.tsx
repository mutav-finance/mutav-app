import { getTranslations } from "next-intl/server";

/**
 * Placeholder landing for apps/admin. The full staff shell (sidebar,
 * header, A1–A6 navigation) lands with the A1 milestone per
 * `docs/architecture/admin.md`. This page exists so the empty origin
 * renders something coherent and the Auth0 gate has somewhere to drop
 * users on a successful sign-in.
 */
export default async function AdminPlaceholderPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminShell.placeholder" });

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-text-2 mb-4 font-mono text-xs tracking-widest uppercase">MUTAV</p>
      <h1 className="text-text mb-3 text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-text-2 max-w-md text-sm">{t("subtitle")}</p>
    </div>
  );
}
