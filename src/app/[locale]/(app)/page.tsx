import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { PageContent } from "@/components/page/page-content";
import { PageShell } from "@/components/page/page-shell";
import { SectionCards } from "@/components/section-cards";

import data from "../../data.json";

export default function Page() {
  return (
    <PageShell>
      <PageContent variant="full">
        <SectionCards />
        <div className="px-4 lg:px-6">
          <ChartAreaInteractive />
        </div>
        <DataTable data={data} />
      </PageContent>
    </PageShell>
  );
}
