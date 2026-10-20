import { getTranslations } from "next-intl/server";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { MembersPage } from "@/components/members/members-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "members.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function MembersRoutePage() {
  const t = await getTranslations("members");

  return (
    <PageShell>
      <PageHeader title={t("heading")} subtitle={t("subheading")} />
      <PageContent variant="full">
        <MembersPage />
      </PageContent>
    </PageShell>
  );
}
