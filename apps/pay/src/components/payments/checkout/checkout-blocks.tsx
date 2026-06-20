import { AlertCircle, CheckCircle2 } from "lucide-react";

// Presentational blocks shared by the checkout flow views (Pix + anchor-test).
// Identical markup previously lived in both views.

export function AmountHero({ brl }: { brl: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 pb-1">
      <p className="text-foreground text-3xl font-medium tabular-nums md:text-4xl">{brl}</p>
    </div>
  );
}

export function CompletedBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <CheckCircle2 className="text-foreground size-12" strokeWidth={1.25} />
      <p className="text-foreground text-sm font-medium tracking-wide uppercase">{message}</p>
    </div>
  );
}

export function FailedBlock({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-12">
      <AlertCircle className="text-destructive size-12" strokeWidth={1.25} />
      <p className="text-foreground max-w-prose text-center text-xs">{message}</p>
    </div>
  );
}
