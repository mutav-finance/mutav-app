import { redirect } from "@/i18n/navigation";

/**
 * Landing for the public payment portal. v1 has one method (Stellar address
 * mode) so we redirect straight to `/endereco`. v1.1+ will render a mode
 * picker here when multiple methods are configured per agency.
 */
export default async function PaymentLandingPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId, locale } = await params;
  redirect({ href: `/pagar/${publicId}/endereco`, locale });
}
