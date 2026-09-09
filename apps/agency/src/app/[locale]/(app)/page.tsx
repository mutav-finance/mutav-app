import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { GuaranteeListTable } from "@/components/guarantees/guarantee-list-table";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageShell } from "@mutav/ui/page/page-shell";
import { SectionCards } from "@/components/section-cards";

export default function Page() {
  return (
    <PageShell>
      <PageContent variant="full">
        <SectionCards />
        <div className="px-4 lg:px-6">
          <ChartAreaInteractive />
        </div>
        <GuaranteeListTable defaultSort={[{ id: "urgency", desc: false }]} />
      </PageContent>
    </PageShell>
  );
}
