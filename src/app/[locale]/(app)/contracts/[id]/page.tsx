import { notFound } from "next/navigation";
import { ContractDetailsPage } from "@/components/contracts/contract-details-page";
import { getContractById } from "@/lib/contracts/fixtures";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id } = await params;
  const contract = getContractById(id);
  if (!contract) {
    notFound();
  }
  return <ContractDetailsPage contract={contract} />;
}
