import { PageContent } from "@mutav/ui/page/page-content";
import { PageShell } from "@mutav/ui/page/page-shell";
import { AgencyGuaranteeBook } from "@/components/guarantees/agency-guarantee-book";
import { SectionCards } from "@/components/section-cards";

export default function Page() {
  return (
    <PageShell>
      <PageContent variant="full">
        <SectionCards />
        <AgencyGuaranteeBook />
      </PageContent>
    </PageShell>
  );
}
