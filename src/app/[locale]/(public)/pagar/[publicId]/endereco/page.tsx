import { redirect } from "@/i18n/navigation";

/**
 * Backwards-compat — `/pagar/<id>/endereco` was the Stellar-only payment
 * page in v1; it now lives at `/pagar/<id>/stellar` as part of the
 * unified checkout flow. Existing share links continue to work via this
 * permanent redirect.
 */
export default async function StellarLegacyRedirect({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId, locale } = await params;
  redirect({ href: `/pagar/${publicId}/stellar`, locale });
}
