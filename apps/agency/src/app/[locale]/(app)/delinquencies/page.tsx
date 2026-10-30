import { redirect } from "@mutav/i18n/navigation";
import { CLAIMS_PATH } from "@/lib/guarantees/delinquency-actions";

/** The claims queue moved to `/claims`; old links and bookmarks land there. */
export default async function DelinquenciesRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
  }
  const notice = query.get("notice");
  const target = notice ? `${CLAIMS_PATH}?case=${encodeURIComponent(notice)}` : CLAIMS_PATH;
  redirect({ href: target, locale });
}
