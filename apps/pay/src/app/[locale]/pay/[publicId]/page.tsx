import { notFound } from "next/navigation";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { getTranslations } from "next-intl/server";
import { Banknote, Coins, FlaskConical } from "lucide-react";

import { api } from "@convex/_generated/api";
import { Link, redirect } from "@mutav/i18n/navigation";
import { Mono } from "@mutav/ui/mono";
import { formatBRLCents, formatDateBR } from "@/lib/contracts/format";
import { shouldShowTestanchor } from "@/lib/env";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; publicId: string }>;
}) {
  const { locale, publicId } = await params;
  const t = await getTranslations({ locale, namespace: "checkout.picker.meta" });
  return {
    title: t("title", { publicId }),
    description: t("description"),
  };
}

/**
 * Step 1 — method picker. Two equal-weight cards. Picker is a pure
 * navigation choice; method only commits to the payment row when the
 * deposit actually completes (via markPaidByAnchor / the Horizon
 * indexer). Users can switch freely by hitting back.
 *
 * State redirects:
 *  - paid           → /paid (receipt)
 *  - method=stellar → /stellar (resume in-progress)
 *  - method=pix     → /pix
 */
export default async function CheckoutPickerPage({
  params,
}: {
  params: Promise<{ publicId: string; locale: string }>;
}) {
  const { publicId, locale } = await params;
  const preloaded = await preloadQuery(api.payments.useCases.getPublicByPublicId, { publicId });
  const payment = preloadedQueryResult(preloaded);
  if (!payment) notFound();

  if (payment.state.kind === "paid" || payment.state.kind === "canceled") {
    redirect({ href: `/pay/${publicId}/paid`, locale });
  }
  if (payment.method?.kind === "stellar") {
    redirect({ href: `/pay/${publicId}/stellar`, locale });
  }
  if (payment.method?.kind === "pix") {
    redirect({ href: `/pay/${publicId}/pix`, locale });
  }

  const t = await getTranslations({ locale, namespace: "checkout.picker" });
  const tCommon = await getTranslations({ locale, namespace: "checkout.common" });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-muted-foreground font-mono text-[11px] tracking-[0.06em] uppercase">
          {tCommon("payee")}: {payment.agencyName}
        </p>
        <p className="text-foreground text-3xl font-medium tabular-nums md:text-4xl">
          {formatBRLCents(payment.totalCents)}
        </p>
        <p className="text-muted-foreground text-xs">
          {tCommon("dueDate")} {formatDateBR(payment.dueDate)}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-muted-foreground font-mono text-[11px] tracking-[0.06em] uppercase">
          {t("heading")}
        </h2>
        <div
          className={
            shouldShowTestanchor()
              ? "grid grid-cols-1 gap-2 md:grid-cols-3"
              : "grid grid-cols-1 gap-2 md:grid-cols-2"
          }
        >
          <MethodPickerCard
            href={`/pay/${publicId}/pix`}
            icon={<Banknote className="size-5" strokeWidth={1.25} />}
            title={t("pix.title")}
            subtitle={t("pix.subtitle")}
            duration={t("pix.duration")}
          />
          <MethodPickerCard
            href={`/pay/${publicId}/stellar`}
            icon={<Coins className="size-5" strokeWidth={1.25} />}
            title={t("stellar.title")}
            subtitle={t("stellar.subtitle")}
            duration={t("stellar.duration")}
          />
          {shouldShowTestanchor() ? (
            <MethodPickerCard
              href={`/pay/${publicId}/anchortest`}
              icon={<FlaskConical className="size-5" strokeWidth={1.25} />}
              title={t("anchortest.title")}
              subtitle={t("anchortest.subtitle")}
              duration={t("anchortest.duration")}
            />
          ) : null}
        </div>
      </section>

      <p className="text-muted-foreground border-t pt-4 text-xs leading-relaxed">
        {tCommon("trust")} <Mono className="text-xs">{payment.publicId}</Mono>
      </p>
    </div>
  );
}

function MethodPickerCard({
  href,
  icon,
  title,
  subtitle,
  duration,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  duration: string;
}) {
  return (
    <Link
      href={href}
      className="border-border hover:bg-muted/40 focus-visible:border-amber group flex min-h-[96px] flex-col justify-between gap-2 border p-4 transition-colors"
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-foreground font-mono text-sm tracking-[0.06em] uppercase">
          {title}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground text-xs">{subtitle}</span>
        <span className="text-muted-foreground font-mono text-[10px] tracking-wide uppercase">
          {duration}
        </span>
      </div>
    </Link>
  );
}
