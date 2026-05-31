import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/public/public-shell";
import { Toaster } from "@/components/ui/sonner";

/**
 * Shell for the `/pay/*` namespace. Equivalent to the old `(public)/layout.tsx`
 * in apps/agency, lifted to apps/pay since the `(public)` route group is
 * gone and pay is now its own origin. Wraps `/pay/[publicId]/*` with the
 * canvas scroll container + a11y skip-link + Toaster.
 */
export default async function PayLayout({ children }: { children: React.ReactNode }) {
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
