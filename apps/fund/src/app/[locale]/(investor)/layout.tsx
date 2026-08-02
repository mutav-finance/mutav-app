import { getTranslations } from "next-intl/server";
import { ConnectWallet } from "@/components/investor/connect-wallet";
import { InvestorNav } from "@/components/investor/investor-nav";

/**
 * Keeps its own top-bar arrangement rather than adopting `<AppShell>`, which
 * is the sidebar arrangement. The `dark` class here (not next-themes) is what
 * forces the investor palette; moving this element into a shared shell would
 * flip the portal to light. Tracked as a follow-up alongside the unresolved
 * root-layout scroll contradiction in docs/architecture/nav-shell-audit.md § 6.
 */
export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
  const tA11y = await getTranslations("common.a11y");

  return (
    <div className="dark bg-canvas flex h-full flex-col overflow-y-auto">
      <a href="#main-content" className="skip-link">
        {tA11y("skipToMain")}
      </a>
      <InvestorNav identity={<ConnectWallet />} />
      <main id="main-content" data-front="investidor" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
