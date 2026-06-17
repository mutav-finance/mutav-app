import { useTranslations } from "next-intl";
import { Check, ExternalLink } from "lucide-react";
import { Mono } from "@mutav/ui/mono";
import type { SettlementMethod } from "@convex/payments/domain";

type Props = {
  paidAt: string;
  method: SettlementMethod | null;
};

const TESTNET_TX_BASE = "https://stellar.expert/explorer/testnet/tx";
const PUBLIC_TX_BASE = "https://stellar.expert/explorer/public/tx";

function explorerTxUrl(txHash: string): string {
  const base =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === "public" ? PUBLIC_TX_BASE : TESTNET_TX_BASE;
  return `${base}/${txHash}`;
}

export function PaymentAddressPaidReceipt({ paidAt, method }: Props) {
  const t = useTranslations("paymentFlow.receipt");
  const txHash = method?.kind === "stellar" ? method.txHash : null;
  const paidAtDisplay = formatPaidAt(paidAt);

  return (
    <section
      id="primary-action"
      data-stripe="paid"
      className="border-border bg-surface before:bg-success relative flex flex-col gap-5 border p-6 before:absolute before:inset-x-0 before:top-0 before:h-1"
      aria-labelledby="payment-paid-heading"
    >
      <div className="flex items-center gap-3">
        <span className="border-success bg-success/10 text-success inline-flex size-8 items-center justify-center border">
          <Check className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </span>
        <h2 id="payment-paid-heading" className="font-display text-text text-xl font-bold">
          {t("title")}
        </h2>
      </div>

      <p className="text-text-2 text-sm">{t("subtitle")}</p>

      <dl className="border-border grid grid-cols-1 gap-3 border-t pt-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-2xs text-text-2 tracking-[0.06em] uppercase">{t("paidAtLabel")}</dt>
          <dd>
            <Mono className="text-sm">{paidAtDisplay}</Mono>
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-2xs text-text-2 tracking-[0.06em] uppercase">{t("txHashLabel")}</dt>
          <dd>
            {txHash ? (
              <a
                href={explorerTxUrl(txHash)}
                target="_blank"
                rel="noopener"
                className="text-text hover:text-accent focus-visible:text-accent inline-flex items-center gap-1 text-sm focus-visible:outline-none"
              >
                <Mono className="text-sm">{txHash.slice(0, 12)}…</Mono>
                <ExternalLink className="size-3.5" strokeWidth={1.25} aria-hidden="true" />
              </a>
            ) : (
              <span className="text-text-2 text-sm">—</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function formatPaidAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}
