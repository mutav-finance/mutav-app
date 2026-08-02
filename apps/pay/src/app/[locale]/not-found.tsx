import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import { NotFoundContent } from "@/components/not-found-content";

export default function NotFound() {
  return (
    <BareShell brand={<Wordmark variant="display" size="md" />} dataFront="imobiliarias">
      <NotFoundContent />
    </BareShell>
  );
}
