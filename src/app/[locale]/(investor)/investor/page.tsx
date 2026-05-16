import { PageShell } from "@/components/page/page-shell";
import { PageHeader } from "@/components/page/page-header";
import { PageContent } from "@/components/page/page-content";
import { FundCard } from "@/components/investor/fund-card";
import { ProtocolKpiStrip } from "@/components/investor/protocol-kpi-strip";
import { PortfolioSection } from "@/components/investor/portfolio-section";
import { FUNDS, PROTOCOL_STATS } from "@/components/investor/fund-data";

export default function InvestorDashboardPage() {
  return (
    <div className="flex flex-1 flex-col">
      <ProtocolKpiStrip stats={PROTOCOL_STATS} variant="wide" showTrustedBy />
      <PageShell>
        <PageHeader
          width="wide"
          title="Funds"
          subtitle="Earn yield on Stellar by backing verified rental guarantees."
        />
        <PageContent variant="wide">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {FUNDS.map((fund) => (
              <FundCard key={fund.id} fund={fund} />
            ))}
          </div>
          <PortfolioSection />
        </PageContent>
      </PageShell>
    </div>
  );
}
