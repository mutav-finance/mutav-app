import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/public/public-shell";
import { Toaster } from "@/components/ui/sonner";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const tA11y = await getTranslations("common.a11y");

  return (
    <PublicShell>
      <a href="#primary-action" className="skip-link">
        {tA11y("skipToMain")}
      </a>
      <main id="public-main" data-front="imobiliarias" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      <Toaster />
    </PublicShell>
  );
}
