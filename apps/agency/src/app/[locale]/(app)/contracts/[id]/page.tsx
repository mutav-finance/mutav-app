import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { ContractDetailsPage } from "@/components/contracts/contract-details-page";
import { getAuthToken } from "@/lib/auth-token";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const token = await getAuthToken();
  const preloaded = await preloadQuery(
    api.contracts.useCases.getByPublicId,
    { publicId: id },
    token ? { token } : undefined,
  );
  const contract = preloadedQueryResult(preloaded);
  if (!contract) {
    notFound();
  }
  return <ContractDetailsPage preloaded={preloaded} />;
}
