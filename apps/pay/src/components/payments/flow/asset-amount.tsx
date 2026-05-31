import { Mono } from "@/components/ui/mono";

type Props = {
  amountDisplay: string;
  assetCode: string;
  brlDisplay: string;
};

export function AssetAmount({ amountDisplay, assetCode, brlDisplay }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <Mono className="text-text text-lg font-medium">
        {amountDisplay} {assetCode}
      </Mono>
      <Mono className="text-text-2 text-sm">≈ {brlDisplay}</Mono>
    </div>
  );
}
