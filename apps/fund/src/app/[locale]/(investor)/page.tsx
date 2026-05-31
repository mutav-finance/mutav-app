import { getTranslations } from "next-intl/server";

/**
 * Placeholder landing for apps/fund's `(investor)` shell. One-screen
 * static content gated on a stubbed wallet-identity check — the gate is
 * for routing/auth posture, not user-facing functionality. PR 4 ships
 * this empty so PR 5 can move the real `(investor)` routes over from
 * apps/agency, and so the wallet-kit selection spec can wire a real
 * connector later.
 *
 * The `wallet: null` stub matches the existing pre-wallet-kit posture in
 * apps/agency's `(investor)` shell. Real wallet-as-identity arrives with
 * the wallet-kit spec.
 */
export default async function InvestorLandingPage() {
  const t = await getTranslations("investorShell.placeholder");
  const wallet: null = null;

  return (
    <section className="mx-auto flex w-full max-w-(--page-content-max-width) flex-col gap-4 px-4 py-12 lg:px-6">
      <h1 className="text-text text-3xl font-bold tracking-tight">{t("heading")}</h1>
      <p className="text-text-2">{t("body")}</p>
      {wallet === null ? (
        <p className="text-text-3 text-sm" data-testid="wallet-disconnected">
          {t("walletDisconnected")}
        </p>
      ) : null}
    </section>
  );
}
