import { useTranslations } from "next-intl";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Wordmark } from "@mutav/ui/wordmark";

/**
 * Brand block — non-interactive, intentionally not a link. Agency renders an
 * AgencySwitcher under its wordmark; staff have no workspace to switch, so the
 * eyebrow is what tells the console apart.
 */
export function AdminSidebarHeader() {
  const t = useTranslations("nav.brand");

  return (
    <div className="flex items-center gap-2 px-2 pt-2 pb-1">
      <Wordmark size="sm" />
      <Eyebrow>{t("eyebrow")}</Eyebrow>
    </div>
  );
}
