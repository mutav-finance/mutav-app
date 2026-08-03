import { getTranslations } from "next-intl/server";
import { InvoiceChip } from "@/components/public/invoice-chip";
import { fetchInvoiceDocumentNumber } from "@/lib/invoices/document-number";
import { PublicFooter } from "@mutav/ui/public/public-footer";
import { PageContent } from "@mutav/ui/page/page-content";
import { FlowShell } from "@mutav/ui/shell/flow-shell";
import { Wordmark } from "@mutav/ui/wordmark";

/**
 * Checkout chrome — wraps every step (`page.tsx`, `stellar/`, `pix/`, `paid/`).
 * No `identity` slot is passed: pay renders the same chrome for authenticated
 * agency users and anonymous tenants, so the app carries no Auth0 SDK.
 *
 * The `[publicId]` segment is the invoice `accessToken`; the chip is fed the
 * resolved document number instead, so the credential never reaches the DOM.
 */
export default async function CheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ publicId: string }>;
}) {
  const { publicId: accessToken } = await params;
  const [tA11y, documentNumber] = await Promise.all([
    getTranslations("common.a11y"),
    fetchInvoiceDocumentNumber(accessToken),
  ]);

  return (
    <FlowShell
      brand={<Wordmark variant="display" size="md" />}
      context={documentNumber ? <InvoiceChip documentNumber={documentNumber} /> : null}
      footer={<PublicFooter />}
      dataFront="imobiliarias"
      skipToMainLabel={tA11y("skipToMain")}
    >
      <PageContent variant="narrow" className="py-6 md:py-10">
        {children}
      </PageContent>
    </FlowShell>
  );
}
