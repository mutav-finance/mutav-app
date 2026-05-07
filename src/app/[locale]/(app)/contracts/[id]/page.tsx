import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { ContractDetailsPage } from "@/components/contracts/contract-details-page";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const preloaded = await preloadQuery(api.contracts.getByPublicId, {
    publicId: id,
  });
  const contract = preloadedQueryResult(preloaded);
  if (!contract) {
    notFound();
  }
  return <ContractDetailsPage preloaded={preloaded} />;
}
