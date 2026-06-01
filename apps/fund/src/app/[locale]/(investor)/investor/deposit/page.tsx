import { DepositPage } from "@/components/investor/deposit-page";

export default async function DepositRoute({
  searchParams,
}: {
  searchParams: Promise<{ fund?: string }>;
}) {
  const { fund } = await searchParams;
  return <DepositPage initialFund={fund} />;
}
