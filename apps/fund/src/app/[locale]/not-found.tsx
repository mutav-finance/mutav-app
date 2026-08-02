import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import { NotFoundContent } from "@/components/not-found-content";

/**
 * `dark` is passed explicitly: fund forces its palette with a literal class on
 * the `(investor)` layout div, which a 404 never renders inside.
 */
export default function NotFound() {
  return (
    <BareShell brand={<Wordmark size="md" />} dataFront="investidor" className="dark">
      <NotFoundContent />
    </BareShell>
  );
}
