import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { GuaranteeDetailsPage } from "@/components/guarantees/guarantee-details-page";
import { getAuthToken } from "@/lib/auth-token";

export default async function GuaranteePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const token = await getAuthToken();
  const preloaded = await preloadQuery(
    api.guarantees.useCases.getByPublicId,
    { publicId: id },
    token ? { token } : undefined,
  );
  const guarantee = preloadedQueryResult(preloaded);
  if (!guarantee) {
    notFound();
  }
  return <GuaranteeDetailsPage preloaded={preloaded} />;
}
