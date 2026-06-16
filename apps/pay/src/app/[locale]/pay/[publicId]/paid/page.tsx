import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, AlertCircle } from "lucide-react";

import { Link, redirect } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Mono } from "@mutav/ui/mono";
import { formatBRLCents, formatDateBR, formatDateTimeBR } from "@/lib/contracts/format";
import { api } from "@convex/_generated/api";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}) {
  const { locale, publicId } = await params;
  const t = await getTranslations({ locale, namespace: "checkout.pago.meta" });
  return {
    title: t("title", { publicId }),
    description: t("description"),
  };
}

/**
 * Step 3 — confirmation / receipt. Renders for `paid` and `canceled`
 * payment states; redirects back to the picker for any not-yet-settled
 * state so users who land here directly aren't stuck on a stale page.
 *
 * The PDF download CTA is deferred until v1.2 (no PDF infra wired yet).
 */
export default async function CheckoutPaidPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId, locale } = await params;
  const preloaded = await preloadQuery(api.invoices.useCases.getPublicByPublicId, { publicId });
  const payment = preloadedQueryResult(preloaded);
  if (!payment) notFound();

  if (payment.state.kind !== "paid" && payment.state.kind !== "void") {
    redirect({ href: `/pay/${publicId}`, locale });
  }

  const t = await getTranslations({ locale, namespace: "checkout.pago" });
  const tCommon = await getTranslations({ locale, namespace: "checkout.common" });

  const isPaid = payment.state.kind === "paid";
  const methodKind = payment.method?.kind ?? null;
  const txReference =
    payment.method?.kind === "stellar"
      ? payment.method.txHash
      : payment.method?.kind === "pix"
        ? payment.method.txId
        : null;

  return (
    <div className="flex flex-col gap-6">
      <div
        aria-hidden
        className={isPaid ? "bg-foreground h-1 w-full" : "bg-muted-foreground/40 h-1 w-full"}
      />

      <div className="flex flex-col items-start gap-2">
        <div className="flex items-center gap-2">
          {isPaid ? (
            <CheckCircle2 className="text-foreground size-5" strokeWidth={1.25} />
          ) : (
            <AlertCircle className="text-muted-foreground size-5" strokeWidth={1.25} />
          )}
          <span className="text-foreground font-mono text-[11px] tracking-[0.08em] uppercase">
            {isPaid ? t("badge.paid") : t("badge.canceled")}
          </span>
        </div>
        <p className="text-foreground text-3xl font-medium tabular-nums md:text-4xl">
          {formatBRLCents(payment.totalCents)}
        </p>
        {isPaid && payment.state.kind === "paid" && (
          <p className="text-muted-foreground text-xs">
            {t("paidVia", { method: methodLabel(t, methodKind) })} ·{" "}
            {formatDateTimeBR(payment.state.paidAt)}
          </p>
        )}
        {!isPaid && (
          <p className="text-muted-foreground text-xs">
            {t("dueWas")} {formatDateBR(payment.dueDate)}
          </p>
        )}
      </div>

      <div className="border-t" />

      <dl className="flex flex-col gap-3">
        <ReceiptRow label={tCommon("payee")} value={payment.agencyName} />
        <ReceiptRow
          label={t("invoiceId")}
          value={<Mono className="text-xs">{payment.publicId}</Mono>}
        />
        {txReference && (
          <ReceiptRow
            label={methodKind === "stellar" ? t("txHash") : t("txId")}
            value={<Mono className="text-xs break-all">{txReference}</Mono>}
          />
        )}
      </dl>

      {!isPaid && (
        <p className="text-muted-foreground border-t pt-4 text-xs">{t("canceledRecovery")}</p>
      )}

      <div className="flex flex-col gap-3 border-t pt-4">
        {isPaid && (
          <Button asChild size="sm">
            <Link href="/payments">{t("backToDashboard")}</Link>
          </Button>
        )}
        <Link
          href={`/pay/${publicId}`}
          className="text-muted-foreground hover:text-foreground text-xs"
        >
          ← {tCommon("backToCheckout")}
        </Link>
      </div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground text-xs tracking-wide uppercase">{label}</dt>
      <dd className="text-foreground text-xs">{value}</dd>
    </div>
  );
}

function methodLabel(t: Awaited<ReturnType<typeof getTranslations>>, kind: string | null): string {
  switch (kind) {
    case "pix":
      return t("methods.pix");
    case "stellar":
      return t("methods.stellar");
    case "boleto":
      return t("methods.boleto");
    default:
      return t("methods.unknown");
  }
}
