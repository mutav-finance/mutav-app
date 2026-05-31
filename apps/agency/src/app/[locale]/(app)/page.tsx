import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { ContractListTable } from "@/components/contracts/contract-list-table";
import { PageContent } from "@/components/page/page-content";
import { PageShell } from "@/components/page/page-shell";
import { SectionCards } from "@/components/section-cards";

export default function Page() {
  return (
    <PageShell>
      <PageContent variant="full">
        <SectionCards />
        <div className="px-4 lg:px-6">
          <ChartAreaInteractive />
        </div>
        <ContractListTable defaultSort={[{ id: "urgency", desc: false }]} />
      </PageContent>
    </PageShell>
  );
}
