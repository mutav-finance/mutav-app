import { AgencySwitcher } from "@/components/agency-switcher";
import { Wordmark } from "@mutav/ui/wordmark";

export function AgencySidebarHeader() {
  return (
    <>
      <div className="px-2 pt-2 pb-1">
        <Wordmark size="sm" />
      </div>
      <AgencySwitcher />
    </>
  );
}
