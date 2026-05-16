import { RedeemPage } from "@/components/investor/redeem-page";

export default async function RedeemRoute({
  searchParams,
}: {
  searchParams: Promise<{ fund?: string }>;
}) {
  const { fund } = await searchParams;
  return <RedeemPage initialFund={fund} />;
}
