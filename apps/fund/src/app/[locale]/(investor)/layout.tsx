import { getTranslations } from "next-intl/server";

/**
 * Shell for the `(investor)` route group in apps/fund. Intentionally
 * minimal — a wrapper div + a placeholder header. This is the empty
 * shell scaffolded in PR 4 (spec § Section 2). The real investor surface
 * (deposit, redeem, NAV, portfolio) moves over from apps/agency's
 * `(investor)` route group in PR 5 and gains a wallet connector after
 * the wallet-kit selection spec lands.
 *
 * Don't bring over any agency-side investor components here — that's
 * PR 5's job, not PR 4's.
 */
export default async function InvestorLayout({ children }: { children: React.ReactNode }) {
  const tA11y = await getTranslations("common.a11y");
  const tShell = await getTranslations("investorShell.header");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <a href="#investor-main" className="skip-link">
        {tA11y("skipToMain")}
      </a>
      <header className="border-border border-b px-4 py-3 lg:px-6">
        <p className="text-text-2 text-sm font-medium">{tShell("title")}</p>
      </header>
      <main
        id="investor-main"
        data-front="investor"
        className="flex min-h-0 flex-1 flex-col overflow-auto"
      >
        {children}
      </main>
    </div>
  );
}
