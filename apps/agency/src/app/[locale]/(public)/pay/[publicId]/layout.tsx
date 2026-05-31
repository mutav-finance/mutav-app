import { PublicHeader } from "@/components/public/public-header";
import { PublicFooter } from "@/components/public/public-footer";
import { PageContent } from "@/components/page/page-content";

/**
 * Checkout chrome — wraps every step (`page.tsx`, `stellar/`, `pix/`, `pago/`).
 * V1 uses PublicHeader/Footer for both agency-authed and renter-public
 * viewers; auth-aware chrome swap (sidebar vs public) is deferred until
 * Auth0 lands (see project_auth_provider memory).
 */
export default async function CheckoutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return (
    <>
      <PublicHeader publicId={publicId} />
      <div className="flex-1">
        <PageContent variant="narrow" className="py-6 md:py-10">
          {children}
        </PageContent>
      </div>
      <PublicFooter />
    </>
  );
}
